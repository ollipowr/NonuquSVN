import { describe, expect, it } from 'vitest';
import { addProject, projectForRepo } from './createProject.js';
import type { ProjectStore } from './projects.js';

const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };

describe('addProject', () => {
  it('creates a project without a working copy or repository', () => {
    const next = addProject(empty, '  Demo  ');
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]).toMatchObject({
      name: 'Demo',
      workspaceIds: [],
      repositoryUrl: undefined,
    });
    expect(next.workspaces).toEqual([]);
    expect(next.activeProjectId).toBe(next.projects[0].id);
  });

  it('stores the repository family key when a URL is given', () => {
    const next = addProject(empty, 'Demo', 'https://host/svn/demo/trunk/');
    expect(next.projects[0].repositoryUrl).toBe('https://host/svn/demo');
  });
});

describe('projectForRepo', () => {
  it('finds the project of the same repository family', () => {
    const store = addProject(empty, 'Demo', 'https://host/svn/demo');
    expect(
      projectForRepo(store, 'https://host/svn/demo/branches/x')?.name,
    ).toBe('Demo');
    expect(projectForRepo(store, 'https://host/svn/other')).toBeUndefined();
  });
});
