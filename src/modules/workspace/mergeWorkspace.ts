import type { BranchRegistry } from '@nonu/modules/branches/branches';
import { workspaceKey } from './workspaceStore.js';

/** Loose working copies can start a merge before visiting Branches. */
export function mergeRegistryForWorkspace(
  registry: BranchRegistry,
  cwd: string,
  url?: string,
): BranchRegistry {
  if (
    !cwd ||
    !url ||
    registry.entries.some(
      (entry) =>
        entry.localPath && workspaceKey(entry.localPath) === workspaceKey(cwd),
    )
  )
    return registry;
  return {
    ...registry,
    entries: [
      ...registry.entries,
      {
        id: 'current-working-copy',
        name: url.replace(/\/+$/, '').split('/').pop() || cwd,
        url,
        localPath: cwd,
        kind: 'other',
      },
    ],
  };
}
