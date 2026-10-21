import type { HostStorage } from '@nonu/host/types';
import type { SvnChange, SvnRepoInfo } from '@nonu/svn';

/** In-memory panel snapshot per workspace: a reopened panel paints the last state and revalidates in the background. */
export interface DiffCacheEntry {
  text: string;
  isNewFile: boolean;
}

export interface PanelSnapshot {
  repo: SvnRepoInfo | null;
  changes: SvnChange[];
  selected: string[];
  active: string | null;
  message: string;
  mtimes: Map<string, number>;
  diffs: Map<string, DiffCacheEntry>;
  filterStatus: string;
  showIgnored: boolean;
  sortBy: string;
  groupByFolder: boolean;
  collapsedFolders: string[];
  /** Date.now() of the last completed status refresh. */
  fetchedAt: number;
}

const snapshots = new Map<string, PanelSnapshot>();

const persistentKey = (cwd: string) => `svn.panelSnapshot:${cwd}`;

/** Reads the last known panel state from host storage after an app restart. */
export function loadPersistentSnapshot(
  cwd: string | null | undefined,
  storage: HostStorage,
): PanelSnapshot | undefined {
  if (!cwd) return undefined;
  const stored = storage.get<
    Partial<PanelSnapshot> & {
      mtimes?: [string, number][];
    }
  >(persistentKey(cwd));
  if (!stored || !Array.isArray(stored.changes)) return undefined;
  return {
    repo: stored.repo ?? null,
    changes: stored.changes,
    selected: Array.isArray(stored.selected) ? stored.selected : [],
    active: typeof stored.active === 'string' ? stored.active : null,
    message: typeof stored.message === 'string' ? stored.message : '',
    mtimes: new Map(stored.mtimes ?? []),
    diffs: new Map(),
    filterStatus:
      typeof stored.filterStatus === 'string' ? stored.filterStatus : 'all',
    showIgnored: stored.showIgnored === true,
    sortBy: typeof stored.sortBy === 'string' ? stored.sortBy : 'path',
    groupByFolder: stored.groupByFolder === true,
    collapsedFolders: Array.isArray(stored.collapsedFolders)
      ? stored.collapsedFolders
      : [],
    fetchedAt: typeof stored.fetchedAt === 'number' ? stored.fetchedAt : 0,
  };
}

/** Persists lightweight workspace data; editor diff buffers remain memory-only. */
export function savePersistentSnapshot(
  cwd: string | null | undefined,
  storage: HostStorage,
  snap: PanelSnapshot,
): void {
  if (!cwd) return;
  void storage.set(persistentKey(cwd), {
    repo: snap.repo,
    changes: snap.changes,
    selected: snap.selected,
    active: snap.active,
    message: snap.message,
    mtimes: Array.from(snap.mtimes.entries()),
    filterStatus: snap.filterStatus,
    showIgnored: snap.showIgnored,
    sortBy: snap.sortBy,
    groupByFolder: snap.groupByFolder,
    collapsedFolders: snap.collapsedFolders,
    fetchedAt: snap.fetchedAt,
  });
}

export function loadSnapshot(
  cwd: string | null | undefined,
): PanelSnapshot | undefined {
  return cwd ? snapshots.get(cwd) : undefined;
}

export function saveSnapshot(
  cwd: string | null | undefined,
  snap: PanelSnapshot,
) {
  if (cwd) snapshots.set(cwd, snap);
}
