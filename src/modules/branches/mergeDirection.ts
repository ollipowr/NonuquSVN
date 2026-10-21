import type { BranchEntry } from './branches.js';

export function defaultMergeDirection(
  entries: BranchEntry[],
  defaultSourceId?: string,
  defaultTargetId?: string,
): { sourceId: string; targetId: string } {
  const targets = entries.filter((entry) => entry.localPath);
  const sourceId =
    defaultSourceId ??
    entries.find(
      (entry) => entry.kind === 'trunk' && entry.id !== defaultTargetId,
    )?.id ??
    entries.find((entry) => entry.id !== defaultTargetId)?.id ??
    '';
  const targetId =
    defaultTargetId ??
    targets.find(
      (entry) => entry.id !== (defaultSourceId ?? '') && entry.kind !== 'trunk',
    )?.id ??
    targets[0]?.id ??
    '';
  return { sourceId, targetId };
}
