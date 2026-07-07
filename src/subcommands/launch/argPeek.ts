const MODEL_FLAG_LONG = "--model";
const MODEL_FLAG_SHORT = "-m";

/**
 * Reads a `--model`/`-m` value out of a passthrough argv array without mutating or consuming it —
 * the tool still receives the flag verbatim. This lets `lms launch claude --model X` resolve/load
 * the model even though `--model` landed in the forwarded args instead of lms's own option (see
 * the argument boundary rules in the launch command).
 */
export function peekModelFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === MODEL_FLAG_LONG || arg === MODEL_FLAG_SHORT) {
      return args[i + 1];
    }
    if (arg.startsWith(`${MODEL_FLAG_LONG}=`)) {
      return arg.slice(MODEL_FLAG_LONG.length + 1);
    }
    if (arg.startsWith(`${MODEL_FLAG_SHORT}=`)) {
      return arg.slice(MODEL_FLAG_SHORT.length + 1);
    }
  }
  return undefined;
}

/**
 * Removes one `--model`/`-m` flag (and its value, if given separately) from a passthrough argv
 * array. Used only for adapters that inject their own authoritative model-selecting arg (e.g.
 * aider's `lm_studio/<model>` prefix), so the tool never sees two conflicting `--model` flags.
 */
export function stripModelFlag(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === MODEL_FLAG_LONG || arg === MODEL_FLAG_SHORT) {
      i++; // also drop the separate value that follows
      continue;
    }
    if (arg.startsWith(`${MODEL_FLAG_LONG}=`) || arg.startsWith(`${MODEL_FLAG_SHORT}=`)) {
      continue;
    }
    result.push(arg);
  }
  return result;
}
