import type { BranchRegistry } from '@nonu/modules/branches';
import { describe, expect, it } from 'vitest';
import {
  chromeBranches,
  loadProjectStore,
  mergeProjects,
  type ProjectStore,
  pickLastWorkspace,
  preferredWorkspace,
  removeProject,
  removeWorkspace,
  renameProject,
  renameWorkspace,
  setWorkspaceHidden,
  workspaceRegistry,
} from './projects.js';

describe('new workspace fields', () => {
  const workspace = (extra: Record<string, unknown>) => ({
    id: 'w1',
    projectId: 'p1',
    name: 'dev',
    svnUrl: 'svn://x/dev',
    kind: 'trunk',
    ...extra,
  });
  const storage = (
    workspaces: unknown[],
    extra: Record<string, unknown> = {},
  ) => ({
    get: () => undefined,
    set: async () => {},
    getGlobal: () => ({
      version: 1,
      projects: [{ id: 'p1', name: 'P', workspaceIds: ['w1'] }],
      workspaces,
      ...extra,
    }),
    setGlobal: async () => {},
  });

  it('keeps valid values and drops malformed persisted values', () => {
    const valid = loadProjectStore(
      storage([workspace({ lastOpenedAt: 5, hidden: true })], {
        recentsImported: true,
      }) as never,
    );
    expect(valid.workspaces[0]).toMatchObject({
      lastOpenedAt: 5,
      hidden: true,
    });
    expect(valid.recentsImported).toBe(true);
    const invalid = loadProjectStore(
      storage([workspace({ lastOpenedAt: 'x', hidden: 'ja' })], {
        recentsImported: 'ja',
      }) as never,
    );
    expect(invalid.workspaces[0].lastOpenedAt).toBeUndefined();
    expect(invalid.workspaces[0].hidden).toBeUndefined();
    expect(invalid.recentsImported).toBeUndefined();
  });
});

const storage = (values: Record<string, unknown>) => ({
  get: () => undefined,
  set: async () => {},
  getGlobal: <T>(key: string) => values[key] as T,
  setGlobal: async () => {},
});
describe('project store', () => {
  it('returns an empty store for broken data', () =>
    expect(
      loadProjectStore(
        storage({ 'nonuqu.projects.v1': { version: 1, projects: 'nope' } }),
      ),
    ).toEqual({ version: 1, projects: [], workspaces: [] }));
  it('migrates the old global registry into one project', () => {
    const store = loadProjectStore(
      storage({
        'svn.branches.v2': {
          entries: [
            {
              id: 'b1',
              name: 'trunk',
              url: 'https://x/a/trunk',
              kind: 'trunk',
            },
          ],
        },
      }),
    );
    expect(store.projects[0].name).toBe('Importierte Branches');
    expect(workspaceRegistry(store, store.activeProjectId).entries[0].url).toBe(
      'https://x/a/trunk',
    );
  });
});

describe('chromeBranches', () => {
  it('marks the entry whose localPath matches cwd as current', () => {
    const registry: BranchRegistry = {
      roots: [],
      entries: [
        {
          id: 'a',
          name: 'trunk',
          url: 'svn://x/trunk',
          localPath: '/wc/trunk',
          kind: 'trunk',
        },
        {
          id: 'b',
          name: 'feature',
          url: 'svn://x/branches/feature',
          localPath: '/wc/feature',
          kind: 'branch',
        },
      ],
    };
    expect(chromeBranches(registry, '/wc/feature')).toEqual([
      { id: 'a', name: 'trunk', isCurrent: false },
      { id: 'b', name: 'feature', isCurrent: true },
    ]);
  });

  it('returns an empty array for an empty registry', () => {
    expect(chromeBranches({ roots: [], entries: [] }, '/wc/anything')).toEqual(
      [],
    );
  });

  it('marks nothing current when no entry matches cwd', () => {
    const registry: BranchRegistry = {
      roots: [],
      entries: [
        {
          id: 'a',
          name: 'trunk',
          url: 'svn://x/trunk',
          localPath: '/wc/trunk',
          kind: 'trunk',
        },
      ],
    };
    expect(chromeBranches(registry, '/wc/unrelated')).toEqual([
      { id: 'a', name: 'trunk', isCurrent: false },
    ]);
  });
});

const base = (): ProjectStore => ({
  version: 1,
  activeProjectId: 'a',
  projects: [
    {
      id: 'a',
      name: 'A',
      workspaceIds: ['w1', 'w2'],
      createdAt: 0,
      updatedAt: 0,
    },
    { id: 'b', name: 'B', workspaceIds: ['w3'], createdAt: 0, updatedAt: 0 },
  ],
  workspaces: [
    {
      id: 'w1',
      projectId: 'a',
      name: 'dev',
      svnUrl: 'u1',
      localPath: 'C:/x/dev',
      kind: 'trunk',
      lastOpenedAt: 5,
    },
    {
      id: 'w2',
      projectId: 'a',
      name: 'rc',
      svnUrl: 'u2',
      localPath: 'C:/x/rc',
      kind: 'branch',
      lastOpenedAt: 9,
    },
    {
      id: 'w3',
      projectId: 'b',
      name: 'dev',
      svnUrl: 'u3',
      localPath: 'c:\\X\\Dev\\',
      kind: 'trunk',
      lastOpenedAt: 7,
    },
  ],
});

describe('store operations', () => {
  it('renames and ignores empty names', () => {
    expect(renameProject(base(), 'a', '  Portal ').projects[0].name).toBe(
      'Portal',
    );
    const same = base();
    expect(renameProject(same, 'a', '  ')).toBe(same);
  });

  it('hides and shows a workspace', () => {
    const hidden = setWorkspaceHidden(base(), 'w1', true);
    expect(hidden.workspaces[0].hidden).toBe(true);
    expect(
      setWorkspaceHidden(hidden, 'w1', false).workspaces[0].hidden,
    ).toBeUndefined();
  });

  it('removes a workspace from the store and from its project', () => {
    const next = removeWorkspace(base(), 'w2');
    expect(next.workspaces.map((w) => w.id)).toEqual(['w1', 'w3']);
    expect(next.projects[0].workspaceIds).toEqual(['w1']);
  });

  it('merges A into B without duplicating the same folder', () => {
    const next = mergeProjects(base(), 'a', 'b');
    expect(next.projects.map((p) => p.id)).toEqual(['b']);
    // w1 (C:/x/dev) is the same folder as w3 and is dropped; w2 moves over.
    expect(next.workspaces.map((w) => w.id).sort()).toEqual(['w2', 'w3']);
    expect(next.workspaces.find((w) => w.id === 'w2')?.projectId).toBe('b');
    expect(next.projects[0].workspaceIds).toEqual(['w3', 'w2']);
    expect(next.activeProjectId).toBe('b');
  });

  it('refuses to merge a project into itself or an unknown one', () => {
    const s = base();
    expect(mergeProjects(s, 'a', 'a')).toBe(s);
    expect(mergeProjects(s, 'a', 'zzz')).toBe(s);
  });

  it('picks the most recently opened local workspace, optionally per project', () => {
    expect(pickLastWorkspace(base())?.id).toBe('w2');
    expect(pickLastWorkspace(base(), 'b')?.id).toBe('w3');
    expect(
      pickLastWorkspace({ version: 1, projects: [], workspaces: [] }),
    ).toBeUndefined();
  });
});

describe('preferredWorkspace', () => {
  const copy = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    projectId: 'p1',
    name: id,
    svnUrl: `svn://x/${id}`,
    localPath: `C:/${id}`,
    kind: 'branch',
    ...extra,
  });
  const store = (
    workspaces: unknown[],
    activeWorkspaceId?: string,
  ): ProjectStore =>
    ({
      version: 1,
      projects: [
        {
          id: 'p1',
          name: 'P',
          workspaceIds: [],
          activeWorkspaceId,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      workspaces,
    }) as unknown as ProjectStore;

  it('prefers the last selected branch', () => {
    const s = store([copy('trunk', { kind: 'trunk' }), copy('dev')], 'dev');
    expect(preferredWorkspace(s, 'p1')?.id).toBe('dev');
  });

  it('falls back to trunk, then the first copy', () => {
    expect(
      preferredWorkspace(
        store([copy('dev'), copy('trunk', { kind: 'trunk' })]),
        'p1',
      )?.id,
    ).toBe('trunk');
    expect(preferredWorkspace(store([copy('dev'), copy('rc')]), 'p1')?.id).toBe(
      'dev',
    );
  });

  it('ignores hidden or folderless copies', () => {
    const s = store(
      [
        copy('gone', { localPath: undefined }),
        copy('h', { hidden: true }),
        copy('only'),
      ],
      'h',
    );
    expect(preferredWorkspace(s, 'p1')?.id).toBe('only');
    expect(preferredWorkspace(store([]), 'p1')).toBeUndefined();
  });
});

describe('removeProject', () => {
  it('drops the project and its copy links, clears the active project', () => {
    const store = {
      version: 1,
      activeProjectId: 'p1',
      projects: [
        {
          id: 'p1',
          name: 'A',
          workspaceIds: ['w1'],
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'p2',
          name: 'B',
          workspaceIds: ['w2'],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      workspaces: [
        {
          id: 'w1',
          projectId: 'p1',
          name: 'dev',
          svnUrl: 'svn://x/dev',
          kind: 'branch',
        },
        {
          id: 'w2',
          projectId: 'p2',
          name: 'dev',
          svnUrl: 'svn://x/dev',
          kind: 'branch',
        },
      ],
    } as unknown as ProjectStore;
    const next = removeProject(store, 'p1');
    expect(next.projects.map((p) => p.id)).toEqual(['p2']);
    expect(next.workspaces.map((w) => w.id)).toEqual(['w2']);
    expect(next.activeProjectId).toBeUndefined();
  });
});

describe('renameWorkspace', () => {
  it('changes only the display name, trimmed', () => {
    const store = {
      version: 1,
      projects: [],
      workspaces: [
        {
          id: 'w1',
          projectId: 'p1',
          name: 'dev',
          svnUrl: 'svn://x/dev',
          kind: 'branch',
        },
      ],
    } as unknown as ProjectStore;
    const next = renameWorkspace(store, 'w1', '  Entwicklung ');
    expect(next.workspaces[0]).toMatchObject({
      name: 'Entwicklung',
      svnUrl: 'svn://x/dev',
    });
    expect(renameWorkspace(store, 'w1', '   ')).toBe(store);
  });
});
