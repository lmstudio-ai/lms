import { clearLine, cursorTo } from "readline";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class ProgressBar {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private spinnerIndex = 0;
  public constructor(
    private ratio = 0,
    private text = "",
    private readonly totalBlocks = 50,
  ) {
    this.timer = setInterval(() => {
      this.spinnerIndex++;
      this.refresh();
    }, 50);
  }
  public stop() {
    if (this.stopped) {
      throw new Error("ProgressBar already stopped");
    }
    this.stopped = true;
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write("\x1B[?25h");
  }
  public setRatio(ratio: number, text?: string) {
    this.ratio = Math.max(0, Math.min(1, ratio));
    this.text = text ?? "";
    this.refresh();
  }
  private refresh() {
    process.stdout.write("\x1B[?25l");
    process.stdout.write(`\r${spinnerFrames[this.spinnerIndex % spinnerFrames.length]} [`);
    this.drawBar();
    process.stdout.write(`] ${(this.ratio * 100).toFixed(2)}%`);
    if (this.text) {
      process.stdout.write(` | ${this.text}`);
    }
  }
  private drawBar() {
    let blocks: string;
    if (this.ratio === 1) {
      blocks = "█".repeat(this.totalBlocks);
    } else {
      const completedBlocks = Math.floor(this.ratio * this.totalBlocks);
      blocks = "█".repeat(completedBlocks);
      const ratioPerBlock = 1 / this.totalBlocks;
      const partialBlock = Math.floor(((this.ratio % ratioPerBlock) / ratioPerBlock) * 8);
      blocks += "▏▎▍▌▋▊▉█".charAt(partialBlock);
      blocks += " ".repeat(this.totalBlocks - completedBlocks - 1);
    }
    process.stdout.write(`${blocks}`);
  }
}
