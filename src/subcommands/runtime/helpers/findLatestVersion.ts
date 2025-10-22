import { compareVersions } from "../../../compareVersions.js";

export function findLatestVersion<TItem extends { version: string }>(
  items: Array<TItem>,
): TItem | null {
  let candidateItem = null;
  for (const item of items) {
    if (candidateItem === null) {
      candidateItem = item;
    } else {
      if (compareVersions(item.version, candidateItem.version) > 0) {
        candidateItem = item;
      }
    }
  }
  return candidateItem;
}
