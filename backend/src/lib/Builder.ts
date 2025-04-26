import path from "path";
import type TypedEmitter from "typed-emitter";
import { _APP_DIR, _NGINX_DIR, _TMP_DIR } from "..";
import fs from "fs/promises";
import { exec, spawn } from "child_process";
import logger from "../logger";
import Storage from "./Storage";
import { log2Project } from "../routes/api/projects";

type MessageEvents = {
  consoleLog: (message: string) => void;
  consoleError: (message: string) => void;

  gitCloneStarted: () => void;
  gitCloneFinished: () => void;
  gitCloneError: (error: string) => void;

  queryStarted: () => void;
  queryFinished: (
    result:
      | {
          success: true;
        }
      | {
          success: false;
          error: string;
        }
  ) => void;

  buildID: (id: string) => void;
};

type BuildQuery = {
  gitURL: string;
  projectID: string;

  dockerScript: string;
  dockerFrom: string;
  startCommand: string;

  allocDomain: string;

  oldContainerID: string | null;
  oldContainerIP: string | null;
  oldContainerImageID: string | null;

  forceIP?: string | null;

  containerExportPort: string;
  requirePasskeyAuth: boolean;
};

class Emitter extends require("events") {
  emit(type: string, ...args: any) {
    logger.log("Emitter", type, ...args);
    super.emit(type, ...args);
    if (this.globalListener) {
      this.globalListener({
        type,
        args,
      });
    }
    if (this.projectID != null) {
      log2Project(
        this.projectID,
        type.padStart(15, " ") +
          " | " +
          args
            .map((x: any) =>
              typeof x == "object"
                ? (() => {
                    try {
                      return JSON.stringify(x);
                    } catch (e) {
                      return x;
                    }
                  })()
                : x.toString()
            )
            .join(" ")
      );
    }
  }

  globalListener: ((event: any) => void) | null = null;
  setGlobalListener(listener: (event: any) => void) {
    this.globalListener = listener;
  }

  projectID: string | null = null;
  setProjectID(projectID: string) {
    this.projectID = projectID;
  }
}

export function reloadNginx() {
  // run command in docker container named nginx
  const reloadChild = spawn(
    "docker",
    ["exec", "nginx", "nginx", "-s", "reload"],
    {
      shell: true,
    }
  );
  let stdoutChunk = "";
  let stderrChunk = "";
  reloadChild.stdout.on("data", (data) => {
    stdoutChunk += data.toString();
    const lines = stdoutChunk.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      logger.log("Nginx", lines[i]);
    }
    stdoutChunk = lines[lines.length - 1];
  });
  reloadChild.stderr.on("data", (data) => {
    stderrChunk += data.toString();
    const lines = stderrChunk.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      logger.error("Nginx", lines[i]);
    }
    stderrChunk = lines[lines.length - 1];
  });
  reloadChild.on("error", (err) => {
    logger.error("Nginx", `Error: ${err}`);
  });
  reloadChild.on("close", (code) => {
    logger.log("Nginx", `nginx reload exited with code ${code}`);
    if (code !== 0) {
      logger.error("Nginx", `nginx reload exited with code ${code}`);
    }
  });
  reloadChild.on("exit", (code) => {
    logger.log("Nginx", `nginx reload exited with code ${code}`);
    if (code !== 0) {
      logger.error("Nginx", `nginx reload exited with code ${code}`);
    }
  });
}

class ContainerBuilderInstance {
  emitter = new Emitter() as any as TypedEmitter<MessageEvents> & {
    setGlobalListener: (listener: (event: any) => void) => void;
    setProjectID: (projectID: string) => void;
  };
  query: BuildQuery | null = null;
  TMP_DIR: string | null = null;
  buildID: string;
  gitHash: string | null = null;

  constructor(query: BuildQuery) {
    this.buildID = Math.random().toString(16).slice(2, 10);
    this.query = query;
    this.emitter.setProjectID(query.projectID);
  }

  async build() {
    if (!this.query) {
      this.emitter.emit("consoleError", "No query to build!");
      this.emitter.emit("queryFinished", {
        success: false,
        error: "No query to build!",
      });
      return;
    }
    this.emitter.emit("queryStarted");
    this.emitter.emit("consoleLog", `Building ${this.query.projectID}...`);

    this.emitter.emit("consoleLog", `BuildID: ${this.buildID}`);
    this.emitter.emit("buildID", this.buildID);

    const TMP_DIR = path.join(
      _TMP_DIR,
      "builders",
      this.query.projectID,
      this.buildID
    );
    this.TMP_DIR = TMP_DIR;

    const this__ = this;

    let newContainerIP: string | null = null;

    /*
    각각의 스텝에서 에러가 발생할 경우
    1. 에러를 발생시킨 스텝에서 에러를 처리하고
    2. 에러로 쿼리 종료
    */
    const steps = [
      // 1. prepare foundation
      async () => {
        await this__.emitter.emit("consoleLog", "Preparing foundation...");
        await this__.emitter.emit("consoleLog", "Creating tmp directory...");
        await fs.mkdir(TMP_DIR, { recursive: true });
        await this__.emitter.emit("consoleLog", "Tmp directory created!");

        await this__.emitter.emit("consoleLog", "Foundation ready!");
        return true;
      },
      // 2. clone git repository
      async () => {
        try {
          await this__.cloneGit();
          this__.emitter.emit("gitCloneFinished");
          const hash = await this__.getGetHash();
          this__.gitHash = hash;
          return true;
        } catch (e: any) {
          this__.emitter.emit("gitCloneError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }
      },
      // 3. create dockerfile
      async () => {
        try {
          await this__.emitter.emit("consoleLog", "Creating Dockerfile...");
          await this__.setupDockerfile();
          this__.emitter.emit("consoleLog", "Dockerfile created!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 4. build dockerfile
      async () => {
        try {
          await this__.emitter.emit("consoleLog", "Building Dockerfile...");
          await this__.buildDockerfile();
          this__.emitter.emit("consoleLog", "Dockerfile built!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 5. get container ip
      async () => {
        try {
          newContainerIP = this.query?.forceIP || (await getContainerIP());
          await Storage.scope("ip").set(newContainerIP, true);
          this__.emitter.emit("consoleLog", `Container IP: ${newContainerIP}`);
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 5.5. create appdata directory
      async () => {
        try {
          const APPDIR = path.join(_APP_DIR, this.query!.projectID);
          await fs.mkdir(APPDIR, { recursive: true });
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },

      // 8. disalloc container ip
      async () => {
        if (typeof this__.query?.oldContainerIP != "string") {
          this__.emitter.emit(
            "consoleLog",
            "No old container IP to disallocate!"
          );
          return true;
        }
        try {
          this__.emitter.emit(
            "consoleLog",
            "Disallocating old container IP..."
          );
          await disallocContainerIP(this.query!.oldContainerIP!);
          this__.emitter.emit("consoleLog", "Container IP disallocated!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 9. remove old container
      async () => {
        try {
          this__.emitter.emit("consoleLog", "Removing old container...");
          await this__.removeOldContainer();
          this__.emitter.emit("consoleLog", "Old container removed!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
        }

        return true;
      },
      // 10. remove old container image
      async () => {
        try {
          this__.emitter.emit("consoleLog", "Removing old image...");
          await this__.removeOldImage();
          this__.emitter.emit("consoleLog", "Old image removed!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
        }

        return true;
      },

      // 6. run container
      async () => {
        try {
          this__.emitter.emit("consoleLog", "Running container...");
          const result = await this__.runContainer(newContainerIP!);
          if (!result) {
            this__.emitter.emit("consoleError", "Failed to run container!");
            return false;
          }
          this__.emitter.emit("consoleLog", "Container running!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 7. change nginx config
      async () => {
        try {
          this__.emitter.emit("consoleLog", "Modifying nginx config...");
          await this__.modifyNginx(newContainerIP!);
          this__.emitter.emit("consoleLog", "Nginx config modified!");
        } catch (e: any) {
          this__.emitter.emit("consoleError", e.toString());
          this__.emitter.emit("queryFinished", {
            success: false,
            error: e.toString(),
          });
          return false;
        }

        return true;
      },
      // 11. update project database
      async () => {
        const db = Storage.scope("projects");
        const get = await db.get(this__.query!.projectID).catch(() => {
          this__.emitter.emit("consoleLog", "Project database not found!");
          return null;
        });
        if (!get) {
          this__.emitter.emit("consoleLog", "No query to update!");
          return false;
        }
        await db.set(this__.query!.projectID, {
          ...get,
          containerID: this__.query!.projectID + "_" + this__.buildID,
          containerIP: newContainerIP,
          containerImageID: this__.buildID,
        });
        this__.emitter.emit("consoleLog", "Project database updated!");
        Storage.scope("project-deploy").set(this__.query!.projectID, {
          gitHash: this__.gitHash,
          buildID: this__.buildID,
        });
        return true;
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      this.emitter.emit(
        "consoleLog",
        `Running step ${i + 1}/${steps.length}...`
      );
      const result = await steps[i]();
      if (!result) {
        await this.cleanUp(true);
        this.emitter.emit("consoleLog", `Step ${i + 1} failed!`);
        return;
      }
    }

    this.emitter.emit("consoleLog", `Build finished!`);
    await this.cleanUp();
    this.emitter.emit("queryFinished", {
      success: true,
    });
  }

  async cleanUp(hasError = false) {
    this.emitter.emit("consoleLog", `Cleaning up...`);
    if (!this.TMP_DIR) {
      this.emitter.emit("consoleLog", `No tmp directory to clean up!`);
      return;
    }
    await fs.rm(this.TMP_DIR!, { recursive: true, force: true });

    // cleanup docker container and image
    // Remove the Docker container and image associated with the current build
    if (hasError)
      try {
        const containerName = `${this.query!.projectID}_${this.buildID}`;
        this.emitter.emit(
          "consoleLog",
          `Removing container: ${containerName}...`
        );
        await new Promise<void>((resolve, reject) => {
          const removeContainerChild = spawn(
            "docker",
            ["rm", "-f", containerName],
            {
              shell: true,
            }
          );
          removeContainerChild.on("close", (code) => {
            if (code === 0) {
              this.emitter.emit(
                "consoleLog",
                `Container ${containerName} removed!`
              );
              resolve();
            } else {
              this.emitter.emit(
                "consoleError",
                `Failed to remove container ${containerName}, exited with code ${code}`
              );
              reject(new Error(`Failed to remove container ${containerName}`));
            }
          });
        });

        this.emitter.emit("consoleLog", `Removing image: ${this.buildID}...`);
        await new Promise<void>((resolve, reject) => {
          const removeImageChild = spawn(
            "docker",
            ["rmi", "-f", this.buildID],
            {
              shell: true,
            }
          );
          removeImageChild.on("close", (code) => {
            if (code === 0) {
              this.emitter.emit("consoleLog", `Image ${this.buildID} removed!`);
              resolve();
            } else {
              this.emitter.emit(
                "consoleError",
                `Failed to remove image ${this.buildID}, exited with code ${code}`
              );
              reject(new Error(`Failed to remove image ${this.buildID}`));
            }
          });
        });
      } catch (error: any) {
        this.emitter.emit("consoleError", `Cleanup error: ${error.message}`);
      }

    this.emitter.emit("consoleLog", `Cleaned up!`);
  }

  async getGetHash() {
    // get hash from git
    return new Promise<string>((resolve, reject) => {
      exec(
        "git rev-parse HEAD",
        { cwd: path.join(this.TMP_DIR!, "repository") },
        (error, stdout) => {
          if (error) {
            this.emitter.emit("consoleError", `Error: ${error}`);
            reject(error);
          } else {
            const hash = stdout.trim();
            this.emitter.emit("consoleLog", `Git hash: ${hash}`);
            resolve(hash);
          }
        }
      );
    });
  }

  async cloneGit() {
    return new Promise<void>((resolve, reject) => {
      const cloneChild = spawn(
        "git",
        ["clone", this.query!.gitURL, path.join(this.TMP_DIR!, "repository")],
        {
          cwd: this.TMP_DIR!,
          shell: true,
        }
      );
      let stdoutChunk = "";
      let stderrChunk = "";
      cloneChild.stdout.on("data", (data) => {
        stdoutChunk += data.toString();
        const lines = stdoutChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleLog", lines[i]);
        }
        stdoutChunk = lines[lines.length - 1];
      });

      cloneChild.stderr.on("data", (data) => {
        stderrChunk += data.toString();
        const lines = stderrChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleError", lines[i]);
        }
        stderrChunk = lines[lines.length - 1];
      });

      cloneChild.on("error", (err) => {
        this.emitter.emit("consoleError", `Error: ${err}`);
        this.emitter.emit("gitCloneError", err.toString());

        reject(err);
      });

      cloneChild.on("close", (code) => {
        this.emitter.emit("consoleLog", `git clone exited with code ${code}`);
        if (code !== 0) {
          this.emitter.emit(
            "gitCloneError",
            `git clone exited with code ${code}`
          );
          reject(new Error(`git clone exited with code ${code}`));
        } else {
          resolve();
        }
      });

      cloneChild.on("exit", (code) => {
        this.emitter.emit("consoleLog", `git clone exited with code ${code}`);
        if (code !== 0) {
          this.emitter.emit(
            "gitCloneError",
            `git clone exited with code ${code}`
          );
          reject(new Error(`git clone exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  async setupDockerfile() {
    const dockerfile = `FROM ${this.query!.dockerFrom}
WORKDIR /app
COPY . .

${this.query!.dockerScript}

CMD ${this.query!.startCommand}`;
    await fs.writeFile(
      path.join(this.TMP_DIR!, "repository", "Dockerfile"),
      dockerfile
    );
    this.emitter.emit("consoleLog", `Dockerfile created!`);
  }

  async buildDockerfile() {
    return new Promise<void>((resolve, reject) => {
      const buildChild = spawn("docker", ["build", "-t", this.buildID!, "."], {
        cwd: path.join(this.TMP_DIR!, "repository"),
        shell: true,
      });
      let stdoutChunk = "";
      let stderrChunk = "";
      buildChild.stdout.on("data", (data) => {
        stdoutChunk += data.toString();
        const lines = stdoutChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleLog", lines[i]);
        }
        stdoutChunk = lines[lines.length - 1];
      });
      buildChild.stderr.on("data", (data) => {
        stderrChunk += data.toString();
        const lines = stderrChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleError", lines[i]);
        }
        stderrChunk = lines[lines.length - 1];
      });
      buildChild.on("error", (err) => {
        this.emitter.emit("consoleError", `Error: ${err}`);
        reject(err);
      });
      buildChild.on("close", (code) => {
        this.emitter.emit(
          "consoleLog",
          `docker build exited with code ${code}`
        );
        if (code !== 0) {
          this.emitter.emit(
            "consoleError",
            `docker build exited with code ${code}`
          );
          reject(new Error(`docker build exited with code ${code}`));
        } else {
          resolve();
        }
      });
      buildChild.on("exit", (code) => {
        this.emitter.emit(
          "consoleLog",
          `docker build exited with code ${code}`
        );
        if (code !== 0) {
          this.emitter.emit(
            "consoleError",
            `docker build exited with code ${code}`
          );
          reject(new Error(`docker build exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  async runContainer(newContainerIP: string) {
    let command = `docker run --name ${this.query!.projectID}_${
      this.buildID
    } -v sharedVolume:/appdata --network br0 --ip ${newContainerIP} --restart=unless-stopped -d ${
      this.buildID
    }`;

    // run command and get is success
    return new Promise<boolean>((resolve, reject) => {
      const runChild = spawn(command, {
        shell: true,
      });
      let stdoutChunk = "";
      let stderrChunk = "";
      runChild.stdout.on("data", (data) => {
        stdoutChunk += data.toString();
        const lines = stdoutChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleLog", lines[i]);
        }
        stdoutChunk = lines[lines.length - 1];
      });
      runChild.stderr.on("data", (data) => {
        stderrChunk += data.toString();
        const lines = stderrChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleError", lines[i]);
        }
        stderrChunk = lines[lines.length - 1];
      });
      runChild.on("error", (err) => {
        this.emitter.emit("consoleError", `Error: ${err}`);
        reject(err);
      });
      runChild.on("close", (code) => {
        this.emitter.emit("consoleLog", `docker run exited with code ${code}`);
        if (code !== 0) {
          this.emitter.emit(
            "consoleError",
            `docker run exited with code ${code}`
          );
          reject(new Error(`docker run exited with code ${code}`));
          return false;
        } else {
          resolve(true);
          return true;
        }
      });
    });
  }

  async modifyNginx(newContainerIP: string) {
    // modify nginx config
    const nginxConfig = `server {
    listen 80;
    server_name ${this.query?.allocDomain};

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${this.query?.allocDomain};

    ssl_certificate "/etc/nginx/conf.d/ssl/${this.query?.allocDomain
      .split(".")
      .slice(1)
      .join(".")}/cert.pem";
    ssl_certificate_key "/etc/nginx/conf.d/ssl/${this.query?.allocDomain
      .split(".")
      .slice(1)
      .join(".")}/cert.key";

    ${
      this.query?.requirePasskeyAuth
        ? `location / {
        auth_request /AidlqSZ1oZu4Rb9a;
        auth_request_set $auth_status $upstream_status;
        error_page 401 /AidlqSZ1oZu4Rb9a;

        proxy_set_header Host "localhost";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass  http://${newContainerIP}:${this.query?.containerExportPort};
    }

    location = /AidlqSZ1oZu4Rb9a {
        internal;
        proxy_set_header smcehpjpvt5x57zs2ojdsbtlxo0mq7ox $request_uri;
        proxy_set_header syyaeag2jv3zzsnzshvv5dm37vn880pk $scheme://$host;
        proxy_pass http://172.20.0.101:41001;
    }`
        : `location / {
        proxy_set_header Host "${this.query?.allocDomain}";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_pass  http://${newContainerIP}:${this.query?.containerExportPort};
    }`
    }
}`;

    await fs.writeFile(
      path.join(_NGINX_DIR, `${this.query?.projectID}.conf`),
      nginxConfig
    );

    reloadNginx();
  }

  async removeOldContainer() {
    return new Promise<void>((resolve, reject) => {
      if (!this.query?.oldContainerID) {
        this.emitter.emit("consoleLog", `No old container to remove!`);
        resolve();
        return;
      }
      const removeChild = spawn(
        "docker",
        ["rm", "-f", this.query.oldContainerID],
        {
          shell: true,
        }
      );
      let stdoutChunk = "";
      let stderrChunk = "";
      removeChild.stdout.on("data", (data) => {
        stdoutChunk += data.toString();
        const lines = stdoutChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleLog", lines[i]);
        }
        stdoutChunk = lines[lines.length - 1];
      });
      removeChild.stderr.on("data", (data) => {
        stderrChunk += data.toString();
        const lines = stderrChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleError", lines[i]);
        }
        stderrChunk = lines[lines.length - 1];
      });
      removeChild.on("error", (err) => {
        this.emitter.emit("consoleError", `Error: ${err}`);
        reject(err);
      });
      removeChild.on("close", (code) => {
        this.emitter.emit("consoleLog", `docker rm exited with code ${code}`);
        if (code !== 0) {
          this.emitter.emit(
            "consoleError",
            `docker rm exited with code ${code}`
          );
          reject(new Error(`docker rm exited with code ${code}`));
          return;
        } else {
          resolve();
          return;
        }
      });
    });
  }

  async removeOldImage() {
    return new Promise<void>((resolve, reject) => {
      if (!this.query?.oldContainerImageID) {
        this.emitter.emit("consoleLog", `No old image to remove!`);
        resolve();
        return;
      }
      const removeChild = spawn(
        "docker",
        ["rmi", "-f", this.query.oldContainerImageID],
        {
          shell: true,
        }
      );
      let stdoutChunk = "";
      let stderrChunk = "";
      removeChild.stdout.on("data", (data) => {
        stdoutChunk += data.toString();
        const lines = stdoutChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleLog", lines[i]);
        }
        stdoutChunk = lines[lines.length - 1];
      });
      removeChild.stderr.on("data", (data) => {
        stderrChunk += data.toString();
        const lines = stderrChunk.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          this.emitter.emit("consoleError", lines[i]);
        }
        stderrChunk = lines[lines.length - 1];
      });
      removeChild.on("error", (err) => {
        this.emitter.emit("consoleError", `Error: ${err}`);
        reject(err);
      });
      removeChild.on("close", (code) => {
        this.emitter.emit("consoleLog", `docker rmi exited with code ${code}`);
        if (code !== 0) {
          this.emitter.emit(
            "consoleError",
            `docker rmi exited with code ${code}`
          );
          reject(new Error(`docker rmi exited with code ${code}`));
          return;
        } else {
          resolve();
          return;
        }
      });
    });
  }
}

export { ContainerBuilderInstance };

export async function getContainerIP() {
  const ipStorage = Storage.scope("ip");
  // 172.20.xxx.xxx
  const getIP = async () => {
    const ip1 = Math.floor(Math.random() * 250) + 2;
    const ip2 = Math.floor(Math.random() * 255);
    const ip = `172.20.${ip1}.${ip2}`;
    if (ip1 == 0) {
      return await getIP();
    }
    if (await ipStorage.has(ip)) {
      return await getIP();
    }
    return ip;
  };

  return await getIP();
}

export async function disallocContainerIP(ip: string) {
  const ipStorage = Storage.scope("ip");
  await ipStorage.delete(ip);
}
