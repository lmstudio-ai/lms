import { type OptionValues } from "@commander-js/extra-typings";
import { type CreateClientArgs } from "../../createClient.js";
import { type LogLevelArgs } from "../../logLevel.js";

type LinkCommandOptionsBase = OptionValues & CreateClientArgs & LogLevelArgs;

export type LinkCommandOptions = LinkCommandOptionsBase;

export type LinkStatusCommandOptions = LinkCommandOptionsBase & {
  json?: boolean;
};

const linkLoaderFrames = [
  "👾 ● ○ ○ ○ 👾",
  "👾 ○ ● ○ ○ 👾",
  "👾 ○ ○ ● ○ 👾",
  "👾 ○ ○ ○ ● 👾",
  "👾 ○ ○ ● ○ 👾",
  "👾 ○ ● ○ ○ 👾",
];

const LINK_LOADER_INTERVAL_MS = 120;

export const startLinkLoader = (intervalMs = LINK_LOADER_INTERVAL_MS) => {
  let frameIndex = 0;
  process.stdout.write(`\r${linkLoaderFrames[frameIndex]}`); // Show first frame immediately
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % linkLoaderFrames.length;
    const frame = linkLoaderFrames[frameIndex];
    process.stdout.write(`\r${frame}`);
  }, intervalMs);

  return () => {
    clearInterval(timer);
    // Clear the loader line from the terminal
    process.stdout.write("\r\x1B[K");
  };
};
