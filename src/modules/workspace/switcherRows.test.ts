import type { ProjectStore } from '@nonu/modules/projects/projects';
import { expect, it } from 'vitest';

import { switcherRows } from './switcherRows.js';

const project = (id: string, name: string) => ({
  id,
  name,
  workspaceIds: [],
  createdAt: 0,
  updatedAt: 0,
});
const ws = (
  id: string,
  projectId: string,
  name: string,
  localPath?: string,
) => ({
  id,
  projectId,
  name,
  svnUrl: `svn://x/${name}`,
  localPath,
  kind: 'branch' as const,
});
const store: ProjectStore = {
  version: 1,
  projects: [project('p1', 'Kundenportal'), project('p2', 'Backoffice')],
  workspaces: [
    ws('w1', 'p1', 'dev', 'C:/a/dev'),
    ws('w2', 'p1', 'rc', 'C:/a/rc'),
    ws('w3', 'p1', 'remote-only'),
    ws('w4', 'p2', 'prod', 'C:/b/prod'),
  ],
};

it('lists local working copies in store order and skips remote-only ones', () => {
  expect(switcherRows(store).map((r) => r.workspaceId)).toEqual([
    'w1',
    'w2',
    'w4',
  ]);
});

it('restricts copies to the selected project', () => {
  expect(switcherRows(store, 'p1').map((r) => r.workspaceId)).toEqual([
    'w1',
    'w2',
  ]);
  expect(switcherRows(store, 'p2').map((r) => r.workspaceId)).toEqual(['w4']);
});

it('returns nothing for no match or an empty store', () => {
  expect(switcherRows(store, 'zzz')).toEqual([]);
  expect(switcherRows({ version: 1, projects: [], workspaces: [] })).toEqual(
    [],
  );
});
