const NUM_VERSION_COMPONENTS = 3;
const VERSION_REGEX = /^\d+(\.\d+){2}$/;

function parseVersion(version: string): number[] {
  if (!VERSION_REGEX.test(version)) {
    throw new Error(
      `Invalid version format: "${version}". Expected MAJOR.MINOR.PATCH with numbers only.`,
    );
  }

  return version.split(".").map(part => {
    const num = +part;
    if (!Number.isSafeInteger(num) || num < 0) {
      throw new Error(`Invalid component ${part} in ${version}`);
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
