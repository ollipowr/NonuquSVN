import { t } from '@nonu/app/i18n';
import type { HostStorage } from '@nonu/host/types';
import {
  type BranchEntry,
  type BranchKind,
  type BranchRegistry,
  branchGroupKey,
} from '@nonu/modules/branches';
import { normalizePath } from '@nonu/modules/branches/branches';

export interface NonuquProject {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  repositoryUrl?: string;
  workspaceIds: string[];
  activeWorkspaceId?: string;
  lastActiveView?: 'changes' | 'branches' | 'repo';
  createdAt: number;
  updatedAt: number;
}

export interface RepositoryWorkspace {
  id: string;
  projectId?: string;
  name: string;
  svnUrl: string;
  localPath?: string;
  kind: BranchKind;
  metadata?: Record<string, string>;
  lastOpenedAt?: number;
  hidden?: boolean;
}

export interface ProjectStore {
  version: 1;
  projects: NonuquProject[];
  workspaces: RepositoryWorkspace[];
  activeProjectId?: string;
  /** Set once the recent folders were filed under projects. */
  recentsImported?: boolean;
}

/** Fired on `window` after the stored projects changed outside the panel. */
export const PROJECTS_CHANGED = 'nonuqu:projects-changed';
export const PROJECT_STORE_KEY = 'nonuqu.projects.v1';
const LEGACY_REGISTRY_KEY = 'svn.branches.v2';
export const EMPTY_PROJECT_STORE: ProjectStore = {
  version: 1,
  projects: [],
  workspaces: [],
};

export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
export function newWorkspaceId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function validWorkspace(value: unknown): value is RepositoryWorkspace {
  const w = value as Partial<RepositoryWorkspace>;
  return (
    !!w &&
    typeof w.id === 'string' &&
    typeof w.name === 'string' &&
    typeof w.svnUrl === 'string' &&
    ['trunk', 'branch', 'tag', 'other'].includes(w.kind ?? '')
  );
}

function cleanWorkspace(w: RepositoryWorkspace): RepositoryWorkspace {
  const { lastOpenedAt, hidden, ...rest } = w;
  return {
    ...rest,
    ...(Number.isFinite(lastOpenedAt) ? { lastOpenedAt } : {}),
    ...(hidden === true ? { hidden } : {}),
  };
}

/** Loads only validated data. Corrupt persisted data never prevents opening a repository. */
export function loadProjectStore(storage: HostStorage): ProjectStore {
  const raw = storage.getGlobal<Partial<ProjectStore>>(PROJECT_STORE_KEY);
  if (
    raw?.version === 1 &&
    Array.isArray(raw.projects) &&
    Array.isArray(raw.workspaces)
  ) {
    const workspaces = raw.workspaces
      .filter(validWorkspace)
      .map(cleanWorkspace);
    const ids = new Set(workspaces.map((w) => w.id));
    const projects = raw.projects
      .filter(
        (p): p is NonuquProject =>
          !!p && typeof p.id === 'string' && typeof p.name === 'string',
      )
      .map((p) => ({
        ...p,
        workspaceIds: (Array.isArray(p.workspaceIds)
          ? p.workspaceIds
          : []
        ).filter((id) => ids.has(id)),
        createdAt: p.createdAt ?? Date.now(),
        updatedAt: p.updatedAt ?? Date.now(),
      }));
    return {
      version: 1,
      projects,
      workspaces,
      activeProjectId: projects.some((p) => p.id === raw.activeProjectId)
        ? raw.activeProjectId
        : undefined,
      ...(raw.recentsImported === true ? { recentsImported: true } : {}),
    };
  }
  // One-time, non-destructive migration. Keep the old key intact as a fallback.
  const old = storage.getGlobal<Partial<BranchRegistry>>(LEGACY_REGISTRY_KEY);
  const entries = Array.isArray(old?.entries)
    ? old.entries.filter(
        (e): e is BranchEntry =>
          !!e && typeof e.id === 'string' && typeof e.url === 'string',
      )
    : [];
  if (!entries.length) return { ...EMPTY_PROJECT_STORE };
  const now = Date.now();
  const id = newProjectId();
  const workspaces = entries.map((e) => ({
    id: e.id,
    projectId: id,
    name: e.name || e.url,
    svnUrl: e.url,
    localPath: e.localPath,
    kind: e.kind || 'other',
  }));
  return {
    version: 1,
    activeProjectId: id,
    projects: [
      {
        id,
        name: t('importedBranchesProject'),
        workspaceIds: workspaces.map((w) => w.id),
        createdAt: now,
        updatedAt: now,
      },
    ],
    workspaces,
  };
}

export function saveProjectStore(
  storage: HostStorage,
  store: ProjectStore,
): Promise<void> {
  return storage.setGlobal(PROJECT_STORE_KEY, { ...store, version: 1 });
}

export function projectWorkspaces(
  store: ProjectStore,
  projectId?: string,
): RepositoryWorkspace[] {
  return store.workspaces.filter((w) => w.projectId === projectId);
}

export function workspaceRegistry(
  store: ProjectStore,
  projectId?: string,
): BranchRegistry {
  return {
    roots: [],
    entries: projectWorkspaces(store, projectId).map((w) => ({
      id: w.id,
      name: w.name,
      url: w.svnUrl,
      localPath: w.localPath,
      kind: w.kind,
      group: branchGroupKey(w.svnUrl),
    })),
  };
}

export function chromeBranches(
  registry: BranchRegistry,
  cwd: string,
): { id: string; name: string; isCurrent: boolean }[] {
  return registry.entries.map((e) => ({
    id: e.id,
    name: e.name,
    isCurrent: e.localPath === cwd,
  }));
}

export function replaceProjectRegistry(
  store: ProjectStore,
  projectId: string | undefined,
  registry: BranchRegistry,
): ProjectStore {
  const retained = store.workspaces.filter((w) => w.projectId !== projectId);
  const previous = new Map(
    store.workspaces
      .filter((w) => w.projectId === projectId)
      .map((w) => [w.id, w]),
  );
  const workspaces = registry.entries.map((e) => ({
    ...previous.get(e.id),
    id: e.id,
    projectId,
    name: e.name,
    svnUrl: e.url,
    localPath: e.localPath,
    kind: e.kind,
  }));
  const now = Date.now();
  return {
    ...store,
    workspaces: [...retained, ...workspaces],
    projects: store.projects.map((p) =>
      p.id === projectId
        ? { ...p, workspaceIds: workspaces.map((w) => w.id), updatedAt: now }
        : p,
    ),
  };
}

export function renameProject(
  store: ProjectStore,
  id: string,
  name: string,
): ProjectStore {
  const trimmed = name.trim();
  if (!trimmed || !store.projects.some((p) => p.id === id)) return store;
  return {
    ...store,
    projects: store.projects.map((p) =>
      p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
    ),
  };
}

export function setWorkspaceHidden(
  store: ProjectStore,
  workspaceId: string,
  hidden: boolean,
): ProjectStore {
  if (!store.workspaces.some((w) => w.id === workspaceId)) return store;
  return {
    ...store,
    workspaces: store.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, hidden: hidden || undefined } : w,
    ),
  };
}

/** Removes only the entry; files on disk are never touched. */
export function removeWorkspace(
  store: ProjectStore,
  workspaceId: string,
): ProjectStore {
  if (!store.workspaces.some((w) => w.id === workspaceId)) return store;
  return {
    ...store,
    workspaces: store.workspaces.filter((w) => w.id !== workspaceId),
    projects: store.projects.map((p) =>
      p.workspaceIds.includes(workspaceId)
        ? {
            ...p,
            workspaceIds: p.workspaceIds.filter((id) => id !== workspaceId),
            activeWorkspaceId:
              p.activeWorkspaceId === workspaceId
                ? undefined
                : p.activeWorkspaceId,
          }
        : p,
    ),
  };
}

/** Changes only the display name of a working copy; the SVN URL and folder stay. */
export function renameWorkspace(
  store: ProjectStore,
  workspaceId: string,
  name: string,
): ProjectStore {
  const trimmed = name.trim();
  if (!trimmed || !store.workspaces.some((w) => w.id === workspaceId))
    return store;
  return {
    ...store,
    workspaces: store.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, name: trimmed } : w,
    ),
  };
}

/** Drops the project and its links to working copies; files on disk stay untouched. */
export function removeProject(
  store: ProjectStore,
  projectId: string,
): ProjectStore {
  if (!store.projects.some((p) => p.id === projectId)) return store;
  return {
    ...store,
    projects: store.projects.filter((p) => p.id !== projectId),
    workspaces: store.workspaces.filter((w) => w.projectId !== projectId),
    activeProjectId:
      store.activeProjectId === projectId ? undefined : store.activeProjectId,
  };
}

/** Moves the working copies of `fromId` into `intoId` and deletes `fromId`. A folder both already have stays once. */
export function mergeProjects(
  store: ProjectStore,
  fromId: string,
  intoId: string,
): ProjectStore {
  const hasBoth =
    store.projects.some((p) => p.id === fromId) &&
    store.projects.some((p) => p.id === intoId);
  if (!hasBoth || fromId === intoId) return store;
  const taken = new Set(
    store.workspaces
      .filter((w) => w.projectId === intoId && w.localPath)
      .map((w) => normalizePath(w.localPath as string)),
  );
  const moved: string[] = [];
  const dropped = new Set<string>();
  for (const w of store.workspaces.filter((x) => x.projectId === fromId)) {
    if (w.localPath && taken.has(normalizePath(w.localPath))) dropped.add(w.id);
    else moved.push(w.id);
  }
  return {
    ...store,
    projects: store.projects
      .filter((p) => p.id !== fromId)
      .map((p) =>
        p.id === intoId
          ? {
              ...p,
              workspaceIds: [...p.workspaceIds, ...moved],
              updatedAt: Date.now(),
            }
          : p,
      ),
    workspaces: store.workspaces
      .filter((w) => !dropped.has(w.id))
      .map((w) => (moved.includes(w.id) ? { ...w, projectId: intoId } : w)),
    activeProjectId:
      store.activeProjectId === fromId ? intoId : store.activeProjectId,
  };
}

/** Most recently opened working copy that has a local folder, optionally within one project. */
export function pickLastWorkspace(
  store: ProjectStore,
  projectId?: string,
): RepositoryWorkspace | undefined {
  return store.workspaces
    .filter(
      (w) =>
        w.localPath &&
        w.lastOpenedAt &&
        (!projectId || w.projectId === projectId),
    )
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
}

/** Branch to preselect when a project is entered: last selected, else the only one, else trunk, else the first. */
export function preferredWorkspace(
  store: ProjectStore,
  projectId: string,
): RepositoryWorkspace | undefined {
  const copies = store.workspaces.filter(
    (w) => w.projectId === projectId && w.localPath && !w.hidden,
  );
  const lastId = store.projects.find(
    (p) => p.id === projectId,
  )?.activeWorkspaceId;
  return (
    copies.find((w) => w.id === lastId) ??
    copies.find((w) => w.kind === 'trunk') ??
    copies[0]
  );
}
