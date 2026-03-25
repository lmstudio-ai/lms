import { Cleaner, makePromise } from "@lmstudio/lms-common";
import { createInterface, type Interface } from "readline/promises";

const interrupted = Symbol("interrupted");

interface AskQuestionOpts {
  rl?: Interface;
  choiceLabel?: string;
}

export async function askQuestionWithChoices<TChoice extends string>(
  prompt: string,
  choices: readonly [TChoice, ...Array<TChoice>],
  opts: AskQuestionOpts = {},
): Promise<TChoice | null> {
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

  const normalizedChoiceMap = new Map<string, TChoice>();
  for (const choice of choices) {
    normalizedChoiceMap.set(choice.toUpperCase(), choice);
  }

  const choiceLabel = opts.choiceLabel ?? choices.join("/");
  let answer: TChoice | undefined;
  do {
    const userResult = await Promise.race([
      rl.question(prompt + ` (${choiceLabel}): `),
      sigintPromise,
    ]);
    if (userResult === interrupted) {
      console.info();
      return null;
    }

    const normalizedUserResult = userResult.trim().toUpperCase();
    const matchedChoice = normalizedChoiceMap.get(normalizedUserResult);
    if (matchedChoice !== undefined) {
      answer = matchedChoice;
    } else {
      process.stderr.write(`Invalid selection. Please enter ${choiceLabel}.\n`);
    }
  } while (answer === undefined);
  return answer;
}

export async function askQuestion(prompt: string, opts: AskQuestionOpts = {}): Promise<boolean> {
  const answer = await askQuestionWithChoices(prompt, ["Y", "N"], opts);
  return answer === "Y";
}
