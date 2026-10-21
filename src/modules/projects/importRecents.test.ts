import type { HostStorage } from '@nonu/host/types';
import type { SvnRepoInfo } from '@nonu/svn';
import { describe, expect, it, vi } from 'vitest';

import { importRecentFolders } from './importRecents.js';
import { loadProjectStore, saveProjectStore } from './projects.js';

const memory = () => {
  const data: Record<string, unknown> = {};
  return {
    get: () => undefined,
    set: async () => {},
    getGlobal: <T>(key: string) => data[key] as T,
    setGlobal: async (key: string, value: unknown) => {
      data[key] = value;
    },
  } as unknown as HostStorage;
};
const infos: Record<string, SvnRepoInfo> = {
  'C:/a/dev': { isWorkingCopy: true, url: 'svn://h/app/trunk' },
  'C:/a/rc': { isWorkingCopy: true, url: 'svn://h/app/branches/rc' },
  'C:/gone': { isWorkingCopy: false },
};
const detect = async (path: string) => {
  if (!(path in infos)) throw new Error('missing');
  return infos[path];
};

describe('importRecentFolders', () => {
  it('imports once in recency order without changing the active project', async () => {
    const storage = memory();
    await saveProjectStore(storage, {
      version: 1,
      activeProjectId: 'keep',
      projects: [
        { id: 'keep', name: 'K', workspaceIds: [], createdAt: 0, updatedAt: 0 },
      ],
      workspaces: [],
    });
    await importRecentFolders(
      storage,
      ['C:/a/rc', 'C:/gone', 'C:/nope', 'C:/a/dev'],
      detect,
      3,
      10_000,
    );
    const store = loadProjectStore(storage);
    expect(store.activeProjectId).toBe('keep');
    expect(store.workspaces.map((workspace) => workspace.lastOpenedAt)).toEqual(
      [10_000, 7_000],
    );
    expect(store.recentsImported).toBe(true);
    const spy = vi.fn(detect);
    await importRecentFolders(storage, ['C:/a/dev'], spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not consume the import when svn is missing', async () => {
    const storage = memory();
    await importRecentFolders(storage, ['C:/a/dev'], async () => ({
      isWorkingCopy: false,
      svnMissing: true,
    }));
    expect(loadProjectStore(storage).recentsImported).toBeUndefined();
  });
});
