import { InvalidArgumentError } from "@commander-js/extra-typings";
import { t } from "../i18n/index.js";

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
      throw new InvalidArgumentError(t("Not a number"));
    }
    if (!Number.isFinite(num)) {
      throw new InvalidArgumentError(t("Not a finite number"));
    }
    if (integer === true && !Number.isInteger(num)) {
      throw new InvalidArgumentError(t("Not an integer"));
    }
    if (min !== undefined && num < min) {
      throw new InvalidArgumentError(t(`Number out of range, must be at least {p0}`, { p0: min }));
    }
    if (max !== undefined && num > max) {
      throw new InvalidArgumentError(t(`Number out of range, must be at most {p0}`, { p0: max }));
    }
    return num;
  };
}
