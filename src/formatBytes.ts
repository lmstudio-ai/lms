import chalk from "chalk";

const kB = 1000;
const mB = 1000 * kB;
const gB = 1000 * mB;
const tB = 1000 * gB;
const grayThreshold = 128 * mB;
const greenThreshold = 1 * gB;
const yellowThreshold = 24 * gB;

export function formatSizeBytes1000(sizeBytes: number) {
  if (sizeBytes < kB) {
    return `${sizeBytes} B`;
  } else if (sizeBytes < mB) {
    return `${(sizeBytes / kB).toFixed(2)} KB`;
  } else if (sizeBytes < gB) {
    return `${(sizeBytes / mB).toFixed(2)} MB`;
  } else if (sizeBytes < tB) {
    return `${(sizeBytes / gB).toFixed(2)} GB`;
  } else {
    return `${(sizeBytes / tB).toFixed(2)} TB`;
  }
}

export function formatSizeBytesWithColor1000(sizeBytes: number) {
  if (sizeBytes < grayThreshold) {
    return chalk.dim(formatSizeBytes1000(sizeBytes));
  } else if (sizeBytes < greenThreshold) {
    return chalk.green(formatSizeBytes1000(sizeBytes));
  } else if (sizeBytes < yellowThreshold) {
    return chalk.yellow(formatSizeBytes1000(sizeBytes));
  } else {
    return chalk.red(formatSizeBytes1000(sizeBytes));
  }
}

