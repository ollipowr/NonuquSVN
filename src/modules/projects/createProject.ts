import { branchGroupKey } from '@nonu/modules/branches/branches';
import {
  type NonuquProject,
  newProjectId,
  type ProjectStore,
} from './projects.js';

/** The project already holding this repository, matched by repo family. */
export function projectForRepo(
  store: ProjectStore,
  url: string,
): NonuquProject | undefined {
  const key = branchGroupKey(url);
  return store.projects.find(
    (p) => p.repositoryUrl && branchGroupKey(p.repositoryUrl) === key,
  );
}

/** A project needs no working copy; the URL is optional. */
export function addProject(
  store: ProjectStore,
  name: string,
  repositoryUrl?: string,
  now = Date.now(),
): ProjectStore {
  const project: NonuquProject = {
    id: newProjectId(),
    name: name.trim(),
    repositoryUrl: repositoryUrl ? branchGroupKey(repositoryUrl) : undefined,
    workspaceIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...store,
    projects: [...store.projects, project],
    activeProjectId: project.id,
  };
}
