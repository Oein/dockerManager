import express from "express";
import Storage from "../../lib/Storage";
import { ContainerBuilderInstance } from "../../lib/Builder";
import logger from "../../logger";
import path from "path";
import fs from "fs/promises";
import { _NGINX_DIR } from "../..";
import { exec } from "child_process";

async function $(
  cmd: string
): Promise<{ text: () => string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        text: () => stdout.toString(),
        exitCode: error ? (error as any).code : 0,
      });
    });
  });
}

const app = express.Router();
const db = Storage.scope("projects");

let logsForProject: { [key: string]: [string, number][] } = {};
export function log2Project(projectID: string, log: string) {
  if (!logsForProject[projectID]) {
    logsForProject[projectID] = [];
  }
  logsForProject[projectID].push([log, Date.now()]);
}

if ((await Storage.waitLoaded()) && !(await db.has("id"))) {
  await db.set("id", []);
}

type Project = {
  id: string;
  name: string;
  description?: string;

  gitURL: string;
  dockerScript: string;
  dockerFrom: string;
  startCommand: string;
  allocDomain: string;

  containerID: string | null;
  containerIP: string | null;
  containerImageID: string | null;
  forceIP: string;
  containerExportPort: string;
  requirePasskeyAuth: boolean;
};

const buildQueue: ContainerBuilderInstance[] = [];
const deleteQueue: {
  id: string;
  containerIP: string;
  containerID: string;
  containerImageID: string;
  projectID: string;
}[] = [];

const buildManager = () => {
  let building = false;
  const buildInterval = setInterval(() => {
    if (building) return;
    if (buildQueue.length === 0) {
      return;
    }

    building = true;
    const buildInstance = buildQueue.shift();
    if (!buildInstance) {
      building = false;
      return;
    }

    logger.info("Builder", "Building", buildInstance.buildID);
    buildInstance
      .build()
      .then(() => {})
      .catch((err) => {
        logger.error("Builder", err);
      });

    buildInstance.emitter.on("queryFinished", (res) => {
      building = false;
      if (res.success) {
        logger.success("Builder", "Build finished", buildInstance.buildID);

        return;
      }

      logger.error("Builder", "Build failed", buildInstance.buildID);
      logger.error("Builder", res.error);
    });
  }, 1000 * 1);
};

const deleteManager = () => {
  let deleting = false;
  const deleteInterval = setInterval(() => {
    if (deleting) return;
    if (deleteQueue.length === 0) {
      return;
    }

    deleting = true;
    const deleteInstance = deleteQueue.shift();
    if (!deleteInstance) {
      deleting = false;
      return;
    }

    logger.info("Builder", "Deleting", deleteInstance.id);
    Promise.all([
      (async () => {
        if (deleteInstance.containerIP) {
          // disalloc ip from db
          await Storage.scope("ip").delete(deleteInstance.containerIP);
        }
      })().catch((err) => {
        logger.error("Builder", "Error deleting ip from db", err);
      }),
      (async () => {
        // remove nginx file
        const nginxFile = `${deleteInstance.projectID}.conf`;
        const nginxPath = path.join(_NGINX_DIR, nginxFile);
        const nginxExists = await fs.exists(nginxPath).catch(() => false);
        if (nginxExists) {
          await fs
            .rm(nginxPath)
            .then(() => {
              logger.success("Builder", "Deleted nginx file", nginxFile);
            })
            .catch((err) => {
              logger.error("Builder", "Error deleting nginx file", err);
            });
        }
      })().catch((err) => {
        logger.error("Builder", "Error deleting container", err);
      }),
      (async () => {
        // remove container
        await $(`docker rm -f ${deleteInstance.containerID}`);
        logger.success("Builder", "Deleted container", deleteInstance.id);
        await $(`docker rmi ${deleteInstance.containerImageID}`);
        logger.success("Builder", "Deleted image", deleteInstance.id);
      })().catch((err) => {
        logger.error("Builder", "Error deleting container", err);
      }),
    ]).finally(() => {
      deleting = false;
      logger.success("Builder", "Delete finished", deleteInstance.id);
    });
  }, 1000 * 1);
};

buildManager();
deleteManager();

app.get("/list", (_, res) => {
  db.get("id").then((projects: string[]) => {
    res.json(projects);
  });
});

app.post("/create", async (req, res) => {
  if (!req.body) {
    res.status(400).json({ error: "No body provided" });
    return;
  }
  const {
    name,
    description,
    gitURL,
    dockerScript,
    startCommand,
    exposePort,
    requirePasskeyAuth,
    allocDomain,
    dockerFrom,
    forceIP,
  } = req.body;
  // check if all required fields are present
  if (
    !name ||
    !gitURL ||
    !dockerScript ||
    !startCommand ||
    !exposePort ||
    !allocDomain ||
    !dockerFrom ||
    typeof requirePasskeyAuth !== "boolean"
  ) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const id = Math.random().toString(16).slice(2, 10);
  const project: Project = {
    id,
    name,
    description,
    gitURL,
    dockerScript,
    dockerFrom,
    startCommand,
    containerIP: null,
    containerID: null,
    containerImageID: null,
    containerExportPort: exposePort,
    requirePasskeyAuth,
    allocDomain,
    forceIP: forceIP || "",
  };
  const buildInstance = new ContainerBuilderInstance({
    projectID: id,
    gitURL,
    dockerScript,
    dockerFrom,
    startCommand,
    containerExportPort: exposePort,
    requirePasskeyAuth,
    allocDomain,
    forceIP: forceIP == "" ? null : forceIP,

    oldContainerID: null,
    oldContainerIP: null,
    oldContainerImageID: null,
  });
  buildQueue.push(buildInstance);
  db.set(id, project).then(() => {
    db.get("id").then((projects: string[]) => {
      projects.push(id);
      db.set("id", projects);
      res.json({ id, build: buildInstance.buildID });
    });
  });
});

app.post("/rebuild/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const buildInstance = new ContainerBuilderInstance({
    projectID: id,
    gitURL: project.gitURL,
    dockerScript: project.dockerScript,
    dockerFrom: project.dockerFrom,
    startCommand: project.startCommand,
    containerExportPort: project.containerExportPort,
    requirePasskeyAuth: project.requirePasskeyAuth,
    allocDomain: project.allocDomain,
    forceIP: project.forceIP == "" ? null : project.forceIP,

    oldContainerID: project.containerID,
    oldContainerIP: project.containerIP,
    oldContainerImageID: project.containerImageID,
  });
  buildQueue.push(buildInstance);
  await db.get("id").then(async (projects: string[]) => {
    if (!projects.includes(id)) {
      projects.push(id);
      await db.set("id", projects);
    }
  });
  res.json({ id, build: buildInstance.buildID });
});

app.post("/delete/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const projects = await db.get("id");
  if (!projects.includes(id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  await db.delete(id);
  const newProjects = projects.filter((projectID: string) => projectID !== id);
  await db.set("id", newProjects);

  const delQid = project.containerID;
  deleteQueue.push({
    id: delQid,
    containerIP: project.containerIP,
    containerID: project.containerID,
    containerImageID: project.containerImageID,
    projectID: id,
  });
  res.json({ success: true, id });
});

app.post("/update/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!req.body) {
    res.status(400).json({ error: "No body provided" });
    return;
  }

  await db.set(id, req.body);
  await db.get("id").then(async (projects: string[]) => {
    if (!projects.includes(id)) {
      projects.push(id);
      await db.set("id", projects);
    }
  });
  res.json({ success: true });
  logger.info("Builder", "Updated project", id);
});

app.get("/logs/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // check if container is running and deployed
  if (!project.containerID) {
    res.status(404).json({ error: "Container not found" });
    return;
  }
  // check if container is running
  const status = await $(
    `docker inspect -f '{{.State.Status}}' ${project.containerID}`
  );
  if (status.text().trim() !== "running") {
    res.status(404).json({ error: "Container not running" });
    return;
  }

  const until = req.query.until;
  const since = req.query.since;

  const cmd = `logs --tail 100 --timestamps${
    typeof until == "string" ? ` --until "${until}"` : ""
  }${typeof since == "string" ? ` --since "${since}"` : ""} ${
    project.containerID
  }`;

  const logs = await $(`docker ${cmd}`);
  res.json({ logs: logs.text() });
});

app.get("/events/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const since = req.query.since;
  const until = req.query.until;

  if (!(id in logsForProject)) {
    res.json({ logs: [] });
    return;
  }
  // binary search for logs
  let from = 0;
  let to = Number.MAX_SAFE_INTEGER;

  if (typeof since == "string") {
    from = parseInt(since);
  }
  if (typeof until == "string") {
    to = parseInt(until);
  }

  // binary search for logs
  let low = 0;
  let high = logsForProject[id].length - 1;
  let mid = 0;
  while (low <= high) {
    mid = Math.floor((low + high) / 2);
    if (logsForProject[id][mid][1] < from) {
      low = mid + 1;
    } else if (logsForProject[id][mid][1] > to) {
      high = mid - 1;
    } else {
      break;
    }
  }
  const logs = logsForProject[id].slice(low, high + 1);
  res.json({ logs });
});

app.get("/status/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const status = await $(
    `docker inspect -f '{{.State.Status}}' ${project.containerID}`
  );
  res.json({ status: status.text() });
});

app.get("/start/:id", async (req, res) => {
  const { id } = req.params;
  const project = await db.get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const start = await $(`docker start ${project.containerID}`);
  if (start.exitCode !== 0) {
    res.status(500).json({ error: "Failed to start container" });
    return;
  }
  res.json({ success: true });
});

app.get("/container/:id", async (req, res) => {
  const { id } = req.params;
  const project = await Storage.scope("project-deploy").get(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

app.get("/:id", (req, res) => {
  const { id } = req.params;
  db.get(id).then((project: Project) => {
    if (!project) {
      res.status(404).json({ error: "Project not found" });
    } else {
      res.json(project);
    }
  });
});

export default app;
