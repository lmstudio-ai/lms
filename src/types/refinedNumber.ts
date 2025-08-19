import { InvalidArgumentError } from "@commander-js/extra-typings";

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

export function createRefinedNumberParser({ integer, min, max }: RefinedNumberOpts = {}): (
  str: string,
) => number {
  return (str: string): number => {
    const num = +str;
    if (Number.isNaN(num)) {
      throw new InvalidArgumentError("Not a number");
    }
    if (!Number.isFinite(num)) {
      throw new InvalidArgumentError("Not a finite number");
    }
    if (integer === true && !Number.isInteger(num)) {
      throw new InvalidArgumentError("Not an integer");
    }
    if (min !== undefined && num < min) {
      throw new InvalidArgumentError(`Number out of range, must be at least ${min}`);
    }
    if (max !== undefined && num > max) {
      throw new InvalidArgumentError(`Number out of range, must be at most ${max}`);
    }
    return num;
  };
}
