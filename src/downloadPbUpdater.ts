import { text } from "@lmstudio/lms-common";
import { type DownloadProgressUpdate } from "@lmstudio/sdk";
import { formatSizeBytes1000 } from "./formatBytes.js";
import { type ProgressBar } from "./ProgressBar.js";

function formatRemainingTime(timeSeconds: number) {
  const seconds = timeSeconds % 60;
  const minutes = Math.floor(timeSeconds / 60) % 60;
  const hours = Math.floor(timeSeconds / 3600);
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Given a progress bar pb, return a function that updates the progress bar with the given
 * DownloadProgressUpdate.
 */
export function createDownloadPbUpdater(pb: ProgressBar) {
  let longestDownloadedBytesStringLength = 6;
  let longestTotalBytesStringLength = 6;
  let longestSpeedBytesPerSecondStringLength = 6;
  return ({ downloadedBytes, totalBytes, speedBytesPerSecond }: DownloadProgressUpdate) => {
    const downloadedBytesString = formatSizeBytes1000(downloadedBytes);
    if (downloadedBytesString.length > longestDownloadedBytesStringLength) {
      longestDownloadedBytesStringLength = downloadedBytesString.length;
    }
    const totalBytesString = formatSizeBytes1000(totalBytes);
    if (totalBytesString.length > longestTotalBytesStringLength) {
      longestTotalBytesStringLength = totalBytesString.length;
    }
    const speedBytesPerSecondString = formatSizeBytes1000(speedBytesPerSecond);
    if (speedBytesPerSecondString.length > longestSpeedBytesPerSecondStringLength) {
      longestSpeedBytesPerSecondStringLength = speedBytesPerSecondString.length;
    }
    const timeLeftSeconds = Math.round((totalBytes - downloadedBytes) / speedBytesPerSecond);
    pb.setRatio(
      downloadedBytes / totalBytes,
      text`
        ${downloadedBytesString.padStart(longestDownloadedBytesStringLength)} /
        ${totalBytesString.padStart(longestTotalBytesStringLength)} |
        ${speedBytesPerSecondString.padStart(longestSpeedBytesPerSecondStringLength)}/s | ETA
        ${formatRemainingTime(timeLeftSeconds)}
      `,
    );
  };
}
