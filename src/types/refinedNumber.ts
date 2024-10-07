import { type Type } from "cmd-ts";

export interface RefinedNumberOpts {
  integer?: boolean;
  /**
   * Inclusive minimum value
   */
  min?: number;
  /**
   * Inclusive maximum value
   */
  max?: number;
}

export function refinedNumber({ integer, min, max }: RefinedNumberOpts = {}): Type<string, number> {
  let description: string;
  if (integer === true) {
    description = "an integer";
  } else {
    description = "a number";
  }
  if (min !== undefined && max === undefined) {
    description += `, at least ${min}`;
  } else if (min === undefined && max !== undefined) {
    description += `, at most ${max}`;
  } else if (min !== undefined && max !== undefined) {
    description += `, between ${min} and ${max}`;
  }
  const type: Type<string, number> = {
    async from(str) {
      const num = +str;
      if (Number.isNaN(num)) {
        throw new Error("Not a number");
      }
      if (!Number.isFinite(num)) {
        throw new Error("Not a finite number");
      }
      if (integer === true && !Number.isInteger(num)) {
        throw new Error("Not an integer");
      }
      if (min !== undefined && num < min) {
        throw new Error(`Number out of range, must be at least ${min}`);
      }
      if (max !== undefined && num > max) {
        throw new Error(`Number out of range, must be at most ${max}`);
      }
      return num;
    },
    displayName: "number",
    description,
  };
  return type;
}
