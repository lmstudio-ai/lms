import { ModelFormatName, modelFormatNameSchema } from "@lmstudio/lms-shared-types";
import { UserInputError } from "../../../types/UserInputError.js";

/**
 * Creates a case-insensitive argument parser for comma-separated model format choices
 * @returns Parser function that handles comma-separated values and validates with zod schema
 */
export function createModelFormatNameParser() {
  return (value: string): ModelFormatName[] => {
    // Split by comma and trim whitespace
    const formats = value.split(",").map(format => format.trim().toUpperCase());

    // Validate each format using zod schema and collect invalid ones
    const validatedFormats: ModelFormatName[] = [];
    const invalidFormats: string[] = [];

    for (const format of formats) {
      try {
        const validated = modelFormatNameSchema.parse(format);
        validatedFormats.push(validated);
      } catch (error) {
        invalidFormats.push(format);
      }
    }

    // Throw error with all invalid choices if any found
    if (invalidFormats.length > 0) {
      const invalidList = invalidFormats.join(", ");
      const validList = modelFormatNameSchema.options.join(", ");
      throw new UserInputError(
        `Invalid choice${invalidFormats.length > 1 ? "s" : ""}: ${invalidList}. Valid choices are: ${validList}`,
      );
    }

    return validatedFormats;
  };
}
