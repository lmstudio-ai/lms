npm install @lmstudio/lms-common

npm install @lmstudio/lms-common

npm install @lmstudio/lms-common

import { text, type SimpleLogger } from 
;
import { execSync } from "child_process";

try {
  execSync("npm install --force @lmstudio/lms-common");
} catch (error) {
  console.error("Failed to install @lmstudio/lms-common:", error);
}
import chalk from "chalk";
import { spawn } from "child_process";
import { command, flag, number, option, optional, subcommands } from "cmd-ts";
import { mkdir, readFile, writeFile } from "fs/promises";
import inquirer from "inquirer";
import os, { platform } from "os";
import path from "path";
import { getCliPref } from "../cliPref";
import { createLogger, logLevelArgs } from "../logLevel";

type HttpServerCtl =
  | {
      type: "start";
      port: number;
      cors?: boolean;
    }
  | {
      type: "stop";
    };

interface HttpServerLastStatus {
  port: number;
}

interface AppInstallLocation {
  path: string;
  argv: Array<string>;
  cwd: string;
}

function getServerCtlPath() {
  return path.join(os.homedir(), ".cache/lm-studio/.internal/http-server-ctl.json");
}

function getServerLastStatusPath() {
  return path.join(os.homedir(), ".cache/lm-studio/.internal/http-server-last-status.json");
}

function getAppInstallLocationPath() {
  return path.join(os.homedir(), ".cache/lm-studio/.internal/app-install-location.json");
}

/**
 * Write a control object to the server control file.
 */
async function writeToServerCtl(logger: SimpleLogger, controlObject: HttpServerCtl) {
  const serverCtlPath = getServerCtlPath();
  logger.debug(`Resolved serverCtlPath: ${serverCtlPath}`);
  const dir = path.dirname(serverCtlPath);
  logger.debug(`Making sure directory exists: ${dir}`);
  await mkdir(dir, { recursive: true });
  logger.debug(`Writing control object to ${serverCtlPath}:`, controlObject);
  await writeFile(serverCtlPath, JSON.stringify(controlObject));
}

/**
 * Launches the LM Studio application.
 */
async function launchApplication(logger: SimpleLogger): Promise<boolean> {
  logger.debug("Launching LM Studio application...");
  const appInstallLocationPath = getAppInstallLocationPath();
  logger.debug(`Resolved appInstallLocationPath: ${appInstallLocationPath}`);
  try {
    const appInstallLocation = JSON.parse(
      await readFile(appInstallLocationPath, "utf-8"),
    ) as AppInstallLocation;
    logger.debug(`Read executable pointer:`, appInstallLocation);

    const args: Array<string> = [];
    const { path, argv, cwd } = appInstallLocation;
    if (argv[1] === ".") {
      // We are in development environment
      args.push(".");
    }
    // Add the minimized flag
    args.push("--minimized");

    logger.debug(`Spawning process:`, { path, args, cwd });

    const child = spawn(path, args, { cwd, detached: true, stdio: "ignore" });
    child.unref();

    logger.debug(`Process spawned`);
    return true;
  } catch (e) {
    logger.debug(`Failed to launch application`, e);
    return false;
  }
}

/**
 * Waits for the server control file to be cleared.
 */
async function waitForCtlFileClear(
  logger: SimpleLogger,
  checkIntervalMs: number,
  maxAttempts: number,
) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    const isEmpty = (await readFile(getServerCtlPath(), "utf-8")).length === 0;
    if (isEmpty) {
      logger.debug(`Attempt ${i + 1}: File has been cleared`);
      return true;
    } else {
      logger.debug(`Attempt ${i + 1}: File has not been cleared`);
    }
  }
  return false;
}

/**
 * Checks if the HTTP server is running.
 */
export async function checkHttpServer(logger: SimpleLogger, port: number) {
  const url = `http://127.0.0.1:${port}/lmstudio-greeting`;
  logger.debug(`Checking server at ${url}`);
  try {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 500).unref();
    const response = await fetch(url, { signal: abortController.signal });
    if (response.status !== 200) {
      logger.debug(`Status is not 200: ${response.status}`);
      return false;
    }
    const json = await response.json();
    if (json?.lmstudio !== true) {
      logger.debug(`Not an LM Studio server:`, json);
      return false;
    }
  } catch (e) {
    logger.debug(`Failed to check server:`, e);
    return false;
  }
  return true;
}

/**
 * Checks the HTTP server with retries.
 */
async function checkHttpServerWithRetries(logger: SimpleLogger, port: number, maxAttempts: number) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHttpServer(logger, port)) {
      logger.debug(`Checked server on attempt ${i + 1}: Server is running`);
      return true;
    } else {
      logger.debug(`Checked server on attempt ${i + 1}: Server is not running`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Gets the last status of the server.
 */
export async function getServerLastStatus(logger: SimpleLogger) {
  const lastStatusPath = getServerLastStatusPath();
  logger.debug(`Reading last status from ${lastStatusPath}`);
  const lastStatus = JSON.parse(await readFile(lastStatusPath, "utf-8")) as HttpServerLastStatus;
  return lastStatus;
}

export interface StartServerOpts {
  port?: number;
  cors?: boolean;
  noLaunch?: boolean;
  yes?: boolean;
  useReducedLogging?: boolean;
}
export async function startServer(
  logger: SimpleLogger,
  { port, cors, noLaunch, yes, useReducedLogging }: StartServerOpts = {},
): Promise<boolean> {
  if (port === undefined) {
    try {
      port = (await getServerLastStatus(logger)).port;
      logger.debug(`Read from last status: port=${port}`);
    } catch (e) {
      logger.debug(`Failed to read last status`, e);
      port = 1234;
      logger.debug(`Using default port ${port}`);
    }
  } else {
    logger.debug(`Using provided port ${port}`);
  }
  if (cors) {
    logger.warnText`
      CORS is enabled. This means any website you visit can use the LM Studio server.
    `;
  }
  logger.logAtLevel(
    useReducedLogging ? "debug" : "info",
    `Attempting to start the server on port ${port}...`,
  );
  await writeToServerCtl(logger, { type: "start", port, cors });
  if (await waitForCtlFileClear(logger, 100, 10)) {
    logger.logAtLevel(
      useReducedLogging ? "debug" : "info",
      `Requested the server to be started on port ${port}.`,
    );
  } else {
    if (platform() === "linux") {
      // Sorry, linux users :(
      logger.errorText`
        LM Studio is not running. Please start LM Studio and try again.
      `;
      return false;
    }
    if (noLaunch) {
      logger.errorText`
        LM Studio is not running. Since --no-launch is provided, LM Studio will not be launched.
      `;
      logger.errorText`
        The server is not started. Please make sure LM Studio is running and try again.
      `;
      return false;
    }
    const cliPref = await getCliPref(logger);
    if (!cliPref.get().autoLaunchMinimizedWarned) {
      if (yes) {
        logger.warn(`Auto-launch warning suppressed by ${chalk.yellowBright("--yes")} flag`);
      } else {
        process.stderr.write(text`
          ${"\n"}${chalk.bold.underline.greenBright("About to Launch LM Studio")}

          By default, if LM Studio is not running, attempting to start the server will launch LM
          Studio in minimized mode and then start the server.

          ${chalk.grey(text`
            If you don't want LM Studio to launch automatically, please use the ${chalk.yellow(
              "--no-launch",
            )} flag.
          `)}

          ${chalk.gray("This confirmation will not be shown again.")}${"\n\n"}
        `);
        await inquirer.createPromptModule({
          output: process.stderr,
        })([
          {
            type: "input",
            name: "confirmation",
            message: `Type "${chalk.greenBright("OK")}" to acknowledge:`,
            validate: value => {
              if (value.toLowerCase() === "ok") {
                return true;
              }
              return 'You need to type "OK" to continue.';
            },
          },
        ]);
        cliPref.setWithProducer(pref => {
          pref.autoLaunchMinimizedWarned = true;
        });
      }
    }

    logger.infoText`
      Launching LM Studio minimized... (Disable auto-launching via the
      ${chalk.yellow("--no-launch")} flag.)
    `;

    const launched = await launchApplication(logger);
    if (launched) {
      logger.debug(`LM Studio launched`);
      // At this point, LM Studio is launching. Once it is ready, it will consume the control file
      // and start the server. Let's wait for that to happen.
      if (await waitForCtlFileClear(logger, 1000, 10)) {
        logger.logAtLevel(
          useReducedLogging ? "debug" : "info",
          `Requested the server to be started on port ${port}.`,
        );
      } else {
        logger.error(`Failed to start the server on port ${port}`);
        process.exit(1);
      }
    } else {
      logger.errorText`
        Failed to launch LM Studio. Please make sure it is installed and have run it at least
        once.
      `;
      return false;
    }
  }
  logger.logAtLevel(useReducedLogging ? "debug" : "info", "Verifying the server is running...");

  if (await checkHttpServerWithRetries(logger, port, 5)) {
    logger.logAtLevel(
      useReducedLogging ? "debug" : "info",
      `Verification succeeded. The server is running on port ${port}.`,
    );
    if (useReducedLogging) {
      logger.info("Successfully started the server and verified it is running.");
    }
    return true;
  } else {
    logger.error("Failed to verify the server is running. Please try to use another port.");
    return false;
  }
}

const start = command({
  name: "start",
  description: "Starts the local server",
  args: {
    port: option({
      type: optional(number),
      description: text`
        Port to run the server on. If not provided, the server will run on the same port as the last
        time it was started.
      `,
      long: "port",
      short: "p",
    }),
    noLaunch: flag({
      description: text`
        Do not launch LM Studio if it is not running. If LM Studio is not running, the server will
        not be started.
      `,
      long: "no-launch",
    }),
    yes: flag({
      description: text`
        Suppress all confirmations and warnings. Useful for scripting.
      `,
      long: "yes",
    }),
    cors: flag({
      description: text`
        Enable CORS on the server. Allows any website you visit to access the server. This is
        required if you are developing a web application.
      `,
      long: "cors",
    }),
    ...logLevelArgs,
  },
  handler: async args => {
    const { port, noLaunch, cors } = args;
    const logger = createLogger(args);
    if (!(await startServer(logger, { port, noLaunch, cors }))) {
      process.exit(1);
    }
  },
});

const stop = command({
  name: "stop",
  description: "Stops the local server",
  args: {
    ...logLevelArgs,
  },
  handler: async args => {
    const logger = createLogger(args);
    let port: number;
    try {
      port = (await getServerLastStatus(logger)).port;
    } catch (e) {
      logger.error(`The server is not running.`);
      process.exit(1);
    }
    const running = await checkHttpServer(logger, port);
    if (!running) {
      logger.error(`The server is not running.`);
      process.exit(1);
    }
    logger.debug(`Attempting to stop the server on port ${port}...`);
    await writeToServerCtl(logger, { type: "stop" });
    if (await waitForCtlFileClear(logger, 100, 10)) {
      logger.info(`Stopped the server on port ${port}.`);
    } else {
      logger.error(`Failed to stop the server on port ${port}`);
      process.exit(1);
    }
  },
});

const status = command({
  name: "status",
  description: "Displays the status of the local server",
  args: {
    ...logLevelArgs,
    json: flag({
      long: "json",
      description: text`
        Outputs the status in JSON format to stdout.
      `,
    }),
  },
  handler: async args => {
    const logger = createLogger(args);
    const { json } = args;
    let port: null | number = null;
    try {
      port = (await getServerLastStatus(logger)).port;
    } catch (e) {
      logger.debug(`Failed to read last status`, e);
    }
    let running = false;
    if (port !== null) {
      running = await checkHttpServer(logger, port);
    }
    if (running) {
      logger.info(`The server is running on port ${port}.`);
    } else {
      logger.info(`The server is not running.`);
    }
    if (json) {
      process.stdout.write(JSON.stringify({ running, port }) + "\n");
    }
  },
});

export const server = subcommands({
  name: "server",
  description: "Commands for managing the local server",
  cmds: {
    start,
    status,
    stop,
  },
});
