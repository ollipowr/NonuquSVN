import type { ProjectStore } from '@nonu/modules/projects/projects';
import type { SvnChange } from '@nonu/svn';
import { describe, expect, it } from 'vitest';

import {
  badgesFor,
  branchRows,
  orderedProjects,
  projectIdForPath,
  resumeCards,
  summarize,
} from './startModel.js';

const change = (status: SvnChange['status']): SvnChange => ({
  path: status,
  status,
  code: status[0].toUpperCase(),
  committable: true,
});
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
  extra: Record<string, unknown> = {},
) => ({
  id,
  projectId,
  name,
  svnUrl: `svn://x/${name}`,
  localPath: `C:/${projectId}/${name}`,
  kind: 'branch' as const,
  ...extra,
});

describe('badgesFor', () => {
  it('is undefined while nothing is known', () =>
    expect(badgesFor(undefined)).toBeUndefined());

  it('flags a missing folder only', () =>
    expect(badgesFor({ changes: [], missing: true })).toEqual({
      missing: true,
      dirty: 0,
      conflicts: 0,
      update: false,
      clean: false,
    }));

  it('counts changes without ignored entries and marks conflicts and updates', () => {
    const b = badgesFor({
      changes: [change('modified'), change('ignored'), change('conflicted')],
      updateAvailable: true,
    });
    expect(b).toMatchObject({
      dirty: 2,
      conflicts: 1,
      update: true,
      clean: false,
    });
  });

  it('is clean when nothing changed and no update is known', () =>
    expect(badgesFor({ changes: [change('ignored')] })?.clean).toBe(true));
});

describe('summarize', () => {
  it('adds up dirty files, conflicts and updates and skips unknowns', () => {
    const a = badgesFor({
      changes: [change('modified')],
      updateAvailable: true,
    });
    const b = badgesFor({
      changes: [change('conflicted'), change('modified')],
    });
    expect(summarize([a, undefined, b])).toEqual({
      dirty: 3,
      conflicts: 1,
      updates: 1,
    });
  });
});

const store = (): ProjectStore => ({
  version: 1,
  projects: [
    project('a', 'Alpha'),
    project('b', 'Beta'),
    project('c', 'Gamma'),
  ],
  workspaces: [
    ws('w1', 'a', 'dev', { lastOpenedAt: 5, kind: 'trunk' }),
    ws('w2', 'a', 'rc', { lastOpenedAt: 9 }),
    ws('w3', 'b', 'dev', { lastOpenedAt: 20, kind: 'trunk' }),
    ws('w4', 'c', 'dev'),
  ],
});

describe('orderedProjects', () => {
  it('puts the most recently used project first, then by name', () =>
    expect(orderedProjects(store()).map((p) => p.id)).toEqual(['b', 'a', 'c']));
});

describe('resumeCards', () => {
  it('gives each project its most recently opened working copy', () => {
    const cards = resumeCards(store(), () => false);
    expect(cards.map((c) => [c.project.id, c.workspace.id])).toEqual([
      ['b', 'w3'],
      ['a', 'w2'],
    ]);
  });

  it('falls back to the next younger working copy when a folder is missing', () => {
    const cards = resumeCards(store(), (p) => p.endsWith('/rc'));
    expect(cards.find((c) => c.project.id === 'a')?.workspace.id).toBe('w1');
  });

  it('skips hidden working copies and projects without any', () => {
    const s = store();
    s.workspaces[2] = { ...s.workspaces[2], hidden: true };
    expect(resumeCards(s, () => false).map((c) => c.project.id)).toEqual(['a']);
  });

  it('limits the cards to the three most recent when there are five or more projects', () => {
    const s: ProjectStore = {
      version: 1,
      projects: [1, 2, 3, 4, 5].map((n) => project(`p${n}`, `P${n}`)),
      workspaces: [1, 2, 3, 4, 5].map((n) =>
        ws(`w${n}`, `p${n}`, 'dev', { lastOpenedAt: n }),
      ),
    };
    expect(resumeCards(s, () => false).map((c) => c.project.id)).toEqual([
      'p5',
      'p4',
      'p3',
    ]);
  });
});

describe('branchRows', () => {
  const s: ProjectStore = {
    version: 1,
    projects: [project('a', 'A')],
    workspaces: [
      ws('t1', 'a', 'tagx', { kind: 'tag' }),
      ws('b2', 'a', '2609'),
      ws('b1', 'a', '2503'),
      ws('tr', 'a', 'trunk', { kind: 'trunk' }),
      ws('hid', 'a', 'old', { hidden: true }),
      ws('rem', 'a', 'remote-only', { localPath: undefined }),
    ],
  };

  it('orders trunk, branches (numeric aware), tags and hides hidden and remote-only', () => {
    const { rows, hiddenCount } = branchRows(s, 'a', false);
    expect(rows.map((r) => r.id)).toEqual(['tr', 'b1', 'b2', 't1']);
    expect(hiddenCount).toBe(1);
  });

  it('shows hidden ones on request', () =>
    expect(branchRows(s, 'a', true).rows.map((r) => r.id)).toContain('hid'));
});

describe('projectIdForPath', () => {
  it('finds the project of a known folder in another spelling', () =>
    expect(projectIdForPath(store(), 'c:\\A\\RC\\')).toBe('a'));
  it('returns undefined for unknown folders', () =>
    expect(projectIdForPath(store(), 'D:/other')).toBeUndefined());
});
