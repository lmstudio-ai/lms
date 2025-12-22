export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private spinnerIndex = 0;

  public constructor(private text: string) {
    this.timer = setInterval(() => {
      this.spinnerIndex++;
      this.refresh();
    }, 80);
  }

  public stopIfNotStopped() {
    if (this.stopped === false) {
      this.stop();
    }
  }

  public stop() {
    if (this.stopped === true) {
      throw new Error("Spinner already stopped");
    }
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write("\r\x1B[K");
    process.stdout.write("\x1B[?25h");
  }

  public stopWithoutClear() {
    if (this.stopped === true) {
      throw new Error("Spinner already stopped");
    }
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write("\x1B[?25h");
  }

  public start() {
    if (this.stopped === false) {
      throw new Error("Spinner already started");
    }
    this.stopped = false;
    this.timer = setInterval(() => {
      this.spinnerIndex++;
      this.refresh();
    }, 80);
  }

  public setText(text: string) {
    this.text = text;
    this.refresh();
  }

  private refresh() {
    process.stdout.write("\x1B[?25l");
    process.stdout.write(
      `\r${this.text} ${SPINNER_FRAMES[this.spinnerIndex % SPINNER_FRAMES.length]}`,
    );
  }
}
