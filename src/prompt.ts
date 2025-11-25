function isExitPromptError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  if (error instanceof Error && error.name === "ExitPromptError") {
    return true;
  }
  if (typeof error === "object" && "name" in error) {
    const errorName = (error as { name?: unknown }).name;
    return errorName === "ExitPromptError";
  }
  return false;
}

export async function runPromptWithExitHandling<TValue>(
  promptRunner: () => Promise<TValue>,
): Promise<TValue> {
  try {
    return await promptRunner();
  } catch (error: unknown) {
    if (isExitPromptError(error)) {
      process.exit(1);
    }
    throw error;
  }
}
