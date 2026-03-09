import { Cleaner, makePromise } from "@lmstudio/lms-common";
import { createInterface, type Interface } from "readline/promises";

const interrupted = Symbol("interrupted");

interface AskQuestionOpts {
  rl?: Interface;
}

export async function askQuestion(prompt: string, opts: AskQuestionOpts = {}): Promise<boolean> {
  using cleaner = new Cleaner();
  let rl = opts.rl;
  if (rl === undefined) {
    const createdReadLine = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    cleaner.register(() => createdReadLine.close());
    rl = createdReadLine;
  }
  const { promise: sigintPromise, resolve: sigintResolve } = makePromise<typeof interrupted>();
  const sigintListener = () => {
    sigintResolve(interrupted);
  };
  rl.addListener("SIGINT", sigintListener);
  cleaner.register(() => {
    rl.removeListener("SIGINT", sigintListener);
  });
  let answer: boolean | undefined;
  do {
    const userResult = await Promise.race([rl.question(prompt + " (Y/N): "), sigintPromise]);
    if (userResult === interrupted) {
      console.info();
      return false;
    }
    if (userResult.toUpperCase() === "Y") {
      answer = true;
    } else if (userResult.toUpperCase() === "N") {
      answer = false;
    } else {
      process.stderr.write("Invalid selection. Please enter Y or N.\n");
    }
  } while (answer === undefined);
  return answer;
}
