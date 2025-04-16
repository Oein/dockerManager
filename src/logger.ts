import chalk from "chalk";

class Logger {
  constructor() {}
  timeStr() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
  }
  colorTime() {
    return `[${this.timeStr()}]`;
  }
  scopeText(scope: string) {
    return chalk.cyan(`|${scope.padStart(8, " ").slice(0, 8)}|`);
  }
  log(scope: string, ...args: any[]) {
    console.log(
      this.colorTime(),
      chalk.gray("(default) "),
      this.scopeText(scope),
      ...args
    );
  }
  info(scope: string, ...args: any[]) {
    console.log(
      this.colorTime(),
      chalk.blue("(   info) "),
      this.scopeText(scope),
      ...args
    );
  }
  success(scope: string, ...args: any[]) {
    console.log(
      this.colorTime(),
      chalk.green("(success) "),
      this.scopeText(scope),
      ...args
    );
  }
  warn(scope: string, ...args: any[]) {
    console.log(
      this.colorTime(),
      chalk.yellow("(   warn) "),
      this.scopeText(scope),
      ...args
    );
  }
  error(scope: string, ...args: any[]) {
    console.log(
      this.colorTime(),
      chalk.red("(  error) "),
      this.scopeText(scope),
      ...args
    );
  }
}

const logger = new Logger();

export default logger;
