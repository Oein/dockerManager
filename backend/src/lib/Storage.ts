import path from "path";
import logger from "../logger";
import fs from "fs/promises";

export type StorageScope = {
  set: (key: string, value: any) => Promise<void>;
  get: (key: string) => Promise<any>;
  delete: (key: string) => Promise<void>;
  has: (key: string) => Promise<boolean>;
};

class KVStorage {
  ram: { [key: string]: any } = {};
  loaded = false;

  constructor() {
    this.ram = {};
  }

  waitLoaded() {
    return new Promise<boolean>((resolve) => {
      this.import();
      if (this.loaded) {
        resolve(true);
        return;
      }
      const interval = setInterval(() => {
        if (this.loaded) {
          clearInterval(interval);
          resolve(true);
        }
      }, 100);
    });
  }

  private importing = false;
  async import() {
    if (this.importing) {
      return;
    }
    this.importing = true;

    // check files exist ./storage.json
    const dir = path.join(__dirname, "..", "..", "storage.json");
    const exsists = await fs.exists(dir).catch(() => false);
    logger.info("Storage", "Loading storage.json");

    if (exsists) {
      const data = await fs
        .readFile(dir, "utf-8")
        .then((data) => JSON.parse(data))
        .catch((err) => {
          logger.error("Storage", "Error loading storage.json", err);
          return {};
        });
      if (data === null) {
        logger.error("Storage", "storage.json is null");

        this.loaded = true;
        this.ram = {};
        this.importing = false;
        return;
      }
      logger.success("Storage", "storage.json loaded");
      this.ram = data;
    } else {
      logger.info("Storage", "storage.json not found, creating new one");
      await fs.writeFile(dir, JSON.stringify({}));
      logger.success("Storage", "storage.json created");
      this.ram = {};
    }

    this.loaded = true;
    this.importing = false;
  }

  async export() {
    await Bun.write("storage.json", JSON.stringify(this.ram, null, 2));
    logger.success("Storage", "storage.json saved");
  }

  private async set(key: string, value: any) {
    this.ram[key] = value;
    await this.export();
  }

  private async get(key: string) {
    return this.ram[key];
  }

  private async delete(key: string) {
    delete this.ram[key];
    await this.export();
  }

  public scope(scope: string): StorageScope {
    return {
      set: async (key: string, value: any) => {
        await this.set(`|${scope}|${key}`, value);
      },
      get: async (key: string) => {
        return this.get(`|${scope}|${key}`);
      },
      delete: async (key: string) => {
        await this.delete(`|${scope}|${key}`);
      },
      has: async (key: string) => {
        return `|${scope}|${key}` in this.ram;
      },
    };
  }
}

const Storage = new KVStorage();
export default Storage;
