import {
  branchGroupKey,
  guessKindFromUrl,
  normalizePath,
} from '@nonu/modules/branches/branches';
import type { SvnRepoInfo } from '@nonu/svn';
import { isInRepo } from './checkoutPlan.js';
import {
  type NonuquProject,
  newProjectId,
  newWorkspaceId,
  type ProjectStore,
  type RepositoryWorkspace,
} from './projects.js';

const MARKERS = ['trunk', 'branches', 'tags'];
const segments = (url: string) =>
  url.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Repository name: the segment before trunk/branches/tags, or the last segment. */
export function repoName(url: string): string {
  const parts = segments(url);
  const marker = parts.findIndex((part) =>
    MARKERS.includes(part.toLowerCase()),
  );
  const base = marker >= 0 ? parts.slice(0, marker) : parts;
  return decode(base[base.length - 1] || url);
}

const leafName = (url: string) => {
  const parts = segments(url);
  return decode(parts[parts.length - 1] || url);
};

/** Files an opened working copy under the project of its repository. */
export function attachWorkspace(
  store: ProjectStore,
  path: string,
  info: Pick<SvnRepoInfo, 'url' | 'workingCopyUrl'>,
  now = Date.now(),
): ProjectStore {
  const url = info.workingCopyUrl ?? info.url;
  if (!url) return store;
  const key = branchGroupKey(url);
  const known = store.workspaces.find(
    (workspace) =>
      workspace.localPath &&
      normalizePath(workspace.localPath) === normalizePath(path),
  );
  const project =
    store.projects.find((candidate) => candidate.id === known?.projectId) ??
    // Containment, not the group key: a flat repo (`<repo>/2506`) yields a different key per branch.
    store.projects.find(
      (candidate) =>
        candidate.repositoryUrl &&
        (branchGroupKey(candidate.repositoryUrl) === key ||
          isInRepo(url, candidate.repositoryUrl)),
    ) ??
    store.projects.find((candidate) =>
      store.workspaces.some(
        (workspace) =>
          workspace.projectId === candidate.id &&
          branchGroupKey(workspace.svnUrl) === key,
      ),
    );
  const base: NonuquProject = project ?? {
    id: newProjectId(),
    name: repoName(url),
    repositoryUrl: key,
    workspaceIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const workspace: RepositoryWorkspace = known
    ? {
        ...known,
        projectId: base.id,
        lastOpenedAt: Math.max(known.lastOpenedAt ?? 0, now),
      }
    : {
        id: newWorkspaceId(),
        projectId: base.id,
        name: leafName(url),
        svnUrl: url,
        localPath: path,
        kind: guessKindFromUrl(url) ?? 'other',
        lastOpenedAt: now,
      };
  const nextProject: NonuquProject = {
    ...base,
    repositoryUrl: base.repositoryUrl ?? key,
    workspaceIds: base.workspaceIds.includes(workspace.id)
      ? base.workspaceIds
      : [...base.workspaceIds, workspace.id],
    updatedAt: now,
  };
  return {
    ...store,
    projects: project
      ? store.projects.map((candidate) =>
          candidate.id === base.id ? nextProject : candidate,
        )
      : [...store.projects, nextProject],
    workspaces: known
      ? store.workspaces.map((candidate) =>
          candidate.id === known.id ? workspace : candidate,
        )
      : [...store.workspaces, workspace],
    activeProjectId: base.id,
  };
}
