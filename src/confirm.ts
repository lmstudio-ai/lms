import { Cleaner } from "@lmstudio/lms-common";
import { createInterface } from "readline/promises";

export async function askQuestion(prompt: string): Promise<boolean> {
  using cleaner = new Cleaner();
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  cleaner.register(() => rl.close());
  let answer: boolean | undefined;
  do {
    const answerText = await rl.question(prompt);
    if (answerText.toUpperCase() === "Y") {
      answer = true;
    } else if (answerText.toUpperCase() === "N") {
      answer = false;
    } else {
      process.stderr.write("Invalid selection. Please enter Y or N.\n");
    }
  } while (answer === undefined);
  return answer;
}
