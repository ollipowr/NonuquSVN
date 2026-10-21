import { describe, expect, it } from 'vitest';

import { attachWorkspace, repoName } from './attach.js';
import type { ProjectStore } from './projects.js';

const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };
const url = (leaf: string) => `https://svn.example.de/svn/Kundenportal/${leaf}`;

describe('repoName', () => {
  it('uses the segment before a standard marker and decodes safely', () => {
    expect(repoName(url('branches/2609'))).toBe('Kundenportal');
    expect(repoName('svn://h/My%20App/trunk')).toBe('My App');
    expect(repoName('svn://h/100%/trunk')).toBe('100%');
  });
});

describe('attachWorkspace', () => {
  it('creates one project for branches of the same repository', () => {
    const one = attachWorkspace(empty, 'C:/work/dev', { url: url('trunk') }, 1);
    const two = attachWorkspace(
      one,
      'C:/work/rc',
      { url: url('branches/rc') },
      2,
    );
    expect(two.projects).toHaveLength(1);
    expect(two.projects[0]).toMatchObject({
      name: 'Kundenportal',
      repositoryUrl: 'https://svn.example.de/svn/kundenportal',
    });
    expect(two.workspaces.map((workspace) => workspace.name)).toEqual([
      'trunk',
      'rc',
    ]);
    expect(two.activeProjectId).toBe(two.projects[0].id);
  });

  it('recognises folder spelling and never lowers its timestamp', () => {
    const one = attachWorkspace(
      empty,
      'C:\\Work\\Dev',
      { url: url('trunk') },
      50,
    );
    const two = attachWorkspace(one, 'c:/work/dev/', { url: url('trunk') }, 10);
    expect(two.workspaces).toHaveLength(1);
    expect(two.workspaces[0].lastOpenedAt).toBe(50);
  });

  it('adopts legacy and loose workspaces, preferring workingCopyUrl', () => {
    const store: ProjectStore = {
      version: 1,
      projects: [
        {
          id: 'p',
          name: 'Legacy',
          workspaceIds: ['w'],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      workspaces: [
        {
          id: 'w',
          projectId: 'p',
          name: 'trunk',
          svnUrl: url('trunk'),
          kind: 'trunk',
        },
      ],
    };
    const next = attachWorkspace(
      store,
      'C:/rc',
      { url: url('branches/rc') },
      3,
    );
    expect(next.projects[0].repositoryUrl).toBe(
      'https://svn.example.de/svn/kundenportal',
    );
    expect(
      attachWorkspace(
        empty,
        'C:/a',
        { url: 'svn://h/r/sub', workingCopyUrl: 'svn://h/r' },
        1,
      ).workspaces[0].svnUrl,
    ).toBe('svn://h/r');
  });

  it('returns the same store without a URL', () => {
    expect(attachWorkspace(empty, 'C:/a', {}, 1)).toBe(empty);
  });
});
