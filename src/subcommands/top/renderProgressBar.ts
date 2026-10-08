import chalk from "chalk";

/**
 * Renders an ANSI colorized ASCII progress bar with percentage.
 *
 * @param ratio Value between 0 and 1 (clamped if out of range, 0 if NaN)
 * @param width Width of the inner bar in characters (default: 22)
 */
export function renderProgressBar(ratio: number, width: number = 22): string {
  const clamped = Math.max(0, Math.min(1, isNaN(ratio) ? 0 : ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const pct = (clamped * 100).toFixed(1);

  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  if (clamped >= 0.9) {
    return `${chalk.red(`[${bar}]`)} ${chalk.red.bold(`${pct}%`)}`;
  } else if (clamped >= 0.75) {
    return `${chalk.yellow(`[${bar}]`)} ${chalk.yellow(`${pct}%`)}`;
  } else {
    return `${chalk.green(`[${bar}]`)} ${chalk.green(`${pct}%`)}`;
  }
}
