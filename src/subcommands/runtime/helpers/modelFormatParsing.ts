import { ModelFormatName, modelFormatNameSchema } from "@lmstudio/lms-shared-types";

export function parseModelFormatNames(
  input: string,
  separator: string = ",",
): Set<ModelFormatName> {
  return new Set(
    input
      .split(separator)
      .map(s => s.toUpperCase())
      .map(s => modelFormatNameSchema.parse(s)),
  );
}
