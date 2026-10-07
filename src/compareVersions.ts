import { t } from "./i18n/index.js";
const NUM_VERSION_COMPONENTS = 3;
const VERSION_REGEX = /^\d+(\.\d+){2}$/;

function parseVersion(version: string): number[] {
  if (!VERSION_REGEX.test(version)) {
    throw new Error(
      t(`Invalid version format: "{p0}". Expected MAJOR.MINOR.PATCH with numbers only.`, {
        p0: version,
      }),
    );
  }

  return version.split(".").map(part => {
    const num = +part;
    if (!Number.isSafeInteger(num) || num < 0) {
      throw new Error(t(`Invalid component {p0} in {p1}`, { p0: part, p1: version }));
    }
    return num;
  });
}

export function compareVersions(a: string, b: string): 1 | -1 | 0 {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  for (let i = 0; i < NUM_VERSION_COMPONENTS; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }

  return 0;
}
