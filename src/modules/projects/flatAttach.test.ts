import { expect, it } from 'vitest';
import { attachWorkspace } from './attach.js';
import { addProject } from './createProject.js';
import type { ProjectStore } from './projects.js';

const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };

it('files flat-layout branches under the project of their repository', () => {
  let s = addProject(empty, 'proj', 'https://svn.example.test/proj');
  s = attachWorkspace(s, 'C:/S/proj_trunk', {
    url: 'https://svn.example.test/proj/trunk',
  });
  s = attachWorkspace(s, 'C:/S/proj_2506', {
    url: 'https://svn.example.test/proj/2506',
  });
  expect(s.projects.map((p) => p.name)).toEqual(['proj']);
  expect(s.workspaces).toHaveLength(2);
});
