import { type SimpleLogger } from "@lmstudio/lms-common";
import { type DownloadProgressUpdate } from "@lmstudio/sdk";
import { askQuestion } from "./confirm.js";
import { createDownloadPbUpdater } from "./downloadPbUpdater.js";
import { ProgressBar } from "./ProgressBar.js";

export async function handleDownloadWithProgressBar(
  logger: SimpleLogger,
  performDownload: (opts: {
    onProgress: (progressUpdate: DownloadProgressUpdate) => void;
    onStartFinalizing: () => void;
    signal: AbortSignal;
  }) => Promise<void>,
) {
  let isAskingExitingBehavior = false;
  let canceled = false;
  const pb = new ProgressBar(0, "", 22);
  const updatePb = createDownloadPbUpdater(pb);
  const abortController = new AbortController();
  const sigintListener = () => {
    process.removeListener("SIGINT", sigintListener);
    process.once("SIGINT", () => {
      process.exit(1);
    });
    pb.stopWithoutClear();
    isAskingExitingBehavior = true;
    logger.infoWithoutPrefix();
    process.stdin.resume();
    askQuestion("Continue to download in the background?").then(confirmed => {
      if (confirmed) {
        logger.info("Download will continue in the background.");
        process.exit(1);
      } else {
        logger.warn("Download canceled.");
        abortController.abort();
        canceled = true;
      }
    });
  };
  process.addListener("SIGINT", sigintListener);
  try {
    await performDownload({
      onProgress: update => {
        if (isAskingExitingBehavior) {
          return;
        }
        updatePb(update);
      },
      onStartFinalizing: () => {
        if (isAskingExitingBehavior) {
          return;
        }
        pb.stop();
        logger.info("Finalizing download...");
      },
      signal: abortController.signal,
    });
    pb.stopIfNotStopped();
    if (canceled) {
      process.exit(1);
    }
    process.removeListener("SIGINT", sigintListener);
    logger.infoText`
      Download completed.
    `;
    logger.info();
  } catch (e: any) {
    if (e.name === "AbortError") {
      process.exit(1);
    } else {
      pb.stopIfNotStopped();
      throw e;
    }
  }
}
