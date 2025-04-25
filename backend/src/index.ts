import Storage from "./lib/Storage";
await Storage.import();

import logger from "./logger";
import path from "path";
import fs from "fs/promises";

logger.info(
  "Global",
  "Voltex " + require("../package.json").version + " starting..."
);

export const _TMP_DIR = path.join(__dirname, "..", "tmp");
const _TMP_DIR_EXISTS = await fs.exists(_TMP_DIR).catch(() => false);

if (!_TMP_DIR_EXISTS) {
  await fs.mkdir(_TMP_DIR, { recursive: true });
  logger.success("Global", "Created tmp directory");
}

export const _APP_DIR = path.join(__dirname, "..", "app");
const _APP_DIR_EXISTS = await fs.exists(_APP_DIR).catch(() => false);

if (!_APP_DIR_EXISTS) {
  await fs.mkdir(_APP_DIR, { recursive: true });
  logger.success("Global", "Created app directory");
}

export const _NGINX_DIR = "/Volumes/hdd_3/nginx";

import app from "./routes";

/*
import * as Builder from "./lib/Builder";
const instance = new Builder.ContainerBuilderInstance();
instance.build({
  projectID: "test-project-01",
  gitURL: "git@github.com:Oein/Discord-SiriTTS-Bot.git",
  dockerScript: `RUN apt-get update
RUN apt-get upgrade -y
RUN apt-get install -y curl unzip
RUN curl -fsSL https://bun.sh/install | bash`,
  startCommand: "bun run index.ts",
});
*/

app.listen(10900, () => {
  logger.success("Global", "Server started on port 10900");
  logger.info("Global", "API URL: http://localhost:10900/api");
});
