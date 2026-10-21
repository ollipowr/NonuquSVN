import type { HostStorage } from '@nonu/host/types';
import { expect, it } from 'vitest';

import { startupWorkspace } from './startup.js';

const storage = (settings: unknown, projects?: unknown) =>
  ({
    get: () => undefined,
    set: async () => {},
    getGlobal: (key: string) =>
      key === 'svn.settings'
        ? settings
        : key === 'nonuqu.projects.v1'
          ? projects
          : undefined,
    setGlobal: async () => {},
  }) as unknown as HostStorage;
const projects = {
  version: 1,
  projects: [{ id: 'p', name: 'P', workspaceIds: ['w1', 'w2'] }],
  workspaces: [
    {
      id: 'w1',
      projectId: 'p',
      name: 'dev',
      svnUrl: 'u',
      localPath: 'C:/a',
      kind: 'trunk',
      lastOpenedAt: 1,
    },
    {
      id: 'w2',
      projectId: 'p',
      name: 'rc',
      svnUrl: 'u',
      localPath: 'C:/b',
      kind: 'branch',
      lastOpenedAt: 2,
    },
  ],
};

it('returns the last opened folder by default and respects an explicit opt-out', () => {
  expect(startupWorkspace(storage({ openLastOnStart: true }, projects))).toBe(
    'C:/b',
  );
  expect(startupWorkspace(storage({}, projects))).toBe('C:/b');
  expect(
    startupWorkspace(storage({ openLastOnStart: false }, projects)),
  ).toBeUndefined();
  expect(startupWorkspace(undefined as unknown as HostStorage)).toBeUndefined();
});
