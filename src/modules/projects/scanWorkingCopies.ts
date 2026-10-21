import { isInRepo } from './checkoutPlan.js';

export interface FoundCopy {
  path: string;
  url: string;
}

type Detect = (path: string) => Promise<{
  isWorkingCopy?: boolean;
  url?: string;
  workingCopyUrl?: string;
}>;

/** Folders below a working copy belong to it, so descending further finds nothing new. */
const MAX_DEPTH = 3;

/** The folder and its subfolders down to `MAX_DEPTH` that are working copies; nested layouts need more than one level. */
export async function scanWorkingCopies(
  folder: string,
  listSubfolders: (dir: string) => Promise<string[]>,
  detect: Detect,
  repoUrl?: string,
  maxDepth = MAX_DEPTH,
): Promise<FoundCopy[]> {
  const found: FoundCopy[] = [];
  const seen = new Set<string>();
  let level = [folder];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next: string[] = [];
    for (const path of level) {
      if (seen.has(path)) continue;
      seen.add(path);
      const info = await detect(path).catch(() => undefined);
      const url = info?.workingCopyUrl ?? info?.url;
      if (info?.isWorkingCopy && url) {
        if (!repoUrl || isInRepo(url, repoUrl)) found.push({ path, url });
        // A working copy's subfolders are part of it, never separate copies.
        continue;
      }
      if (depth < maxDepth)
        next.push(...(await listSubfolders(path).catch(() => [])));
    }
    level = next;
  }
  return found;
}
