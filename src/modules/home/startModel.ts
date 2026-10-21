import { normalizePath } from '@nonu/modules/branches/branches';
import {
  type NonuquProject,
  type ProjectStore,
  pickLastWorkspace,
  type RepositoryWorkspace,
} from '@nonu/modules/projects/projects';
import {
  changeCount,
  conflictCount,
} from '@nonu/modules/workspace/statusBadges';
import type { SvnChange } from '@nonu/svn';

export interface StatusView {
  changes: SvnChange[];
  revision?: string;
  updateAvailable?: boolean;
  /** The folder is gone or is no working copy any more. */
  missing?: boolean;
}

export interface Badges {
  missing: boolean;
  dirty: number;
  conflicts: number;
  update: boolean;
  clean: boolean;
}

export function badgesFor(view: StatusView | undefined): Badges | undefined {
  if (!view) return undefined;
  if (view.missing)
    return {
      missing: true,
      dirty: 0,
      conflicts: 0,
      update: false,
      clean: false,
    };
  const dirty = changeCount(view.changes);
  const update = view.updateAvailable === true;
  return {
    missing: false,
    dirty,
    conflicts: conflictCount(view.changes),
    update,
    clean: dirty === 0 && !update,
  };
}

export function summarize(list: (Badges | undefined)[]) {
  return list.reduce(
    (sum, b) => ({
      dirty: sum.dirty + (b?.dirty ?? 0),
      conflicts: sum.conflicts + (b?.conflicts ?? 0),
      updates: sum.updates + (b?.update ? 1 : 0),
    }),
    { dirty: 0, conflicts: 0, updates: 0 },
  );
}

const lastOpened = (store: ProjectStore, projectId: string) =>
  pickLastWorkspace(store, projectId)?.lastOpenedAt ?? 0;

export function orderedProjects(store: ProjectStore): NonuquProject[] {
  return [...store.projects].sort(
    (a, b) =>
      lastOpened(store, b.id) - lastOpened(store, a.id) ||
      a.name.localeCompare(b.name),
  );
}

export interface ResumeCard {
  project: NonuquProject;
  workspace: RepositoryWorkspace;
}

const MANY_PROJECTS = 5;
const MAX_CARDS = 3;

export function resumeCards(
  store: ProjectStore,
  isMissing: (path: string) => boolean,
): ResumeCard[] {
  const cards = orderedProjects(store).flatMap((project) => {
    const workspace = store.workspaces
      .filter(
        (w) =>
          w.projectId === project.id &&
          w.localPath &&
          w.lastOpenedAt &&
          !w.hidden &&
          !isMissing(w.localPath),
      )
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    return workspace ? [{ project, workspace }] : [];
  });
  return store.projects.length >= MANY_PROJECTS
    ? cards.slice(0, MAX_CARDS)
    : cards;
}

const KIND_ORDER = { trunk: 0, branch: 1, tag: 2, other: 3 } as const;

export function branchRows(
  store: ProjectStore,
  projectId: string,
  showHidden: boolean,
): { rows: RepositoryWorkspace[]; hiddenCount: number } {
  const local = store.workspaces.filter(
    (w) => w.projectId === projectId && w.localPath,
  );
  const rows = local
    .filter((w) => showHidden || !w.hidden)
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  return { rows, hiddenCount: local.filter((w) => w.hidden).length };
}

export function projectIdForPath(
  store: ProjectStore,
  path: string,
): string | undefined {
  return store.workspaces.find(
    (w) => w.localPath && normalizePath(w.localPath) === normalizePath(path),
  )?.projectId;
}
