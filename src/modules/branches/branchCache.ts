import type { BranchStatus } from './branches.js';

/** Runtime status stays out of the persisted registry; module state lets a reopened panel paint at once. */
const cache = new Map<string, Map<string, BranchStatus>>();

export function getBranchStatus(
  cwd: string | null | undefined,
  id: string,
): BranchStatus | undefined {
  return cwd ? cache.get(cwd)?.get(id) : undefined;
}

export function setBranchStatus(
  cwd: string | null | undefined,
  id: string,
  status: BranchStatus,
) {
  if (!cwd) return;
  let perCwd = cache.get(cwd);
  if (!perCwd) {
    perCwd = new Map();
    cache.set(cwd, perCwd);
  }
  perCwd.set(id, status);
}

export function clearBranchStatus(cwd: string | null | undefined) {
  if (cwd) cache.delete(cwd);
}
