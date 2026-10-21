import type { HostStorage } from '@nonu/host/types';
import type { SvnRepoInfo } from '@nonu/svn';
import { describe, expect, it, vi } from 'vitest';

import { loadProjectStore, PROJECTS_CHANGED } from './projects.js';
import { registerWorkspace } from './registerWorkspace.js';

const memory = () => {
  const data: Record<string, unknown> = {};
  const setGlobal = vi.fn(async (key: string, value: unknown) => {
    data[key] = value;
  });
  return {
    storage: {
      get: () => undefined,
      set: async () => {},
      getGlobal: <T>(key: string) => data[key] as T,
      setGlobal,
    } as unknown as HostStorage,
    setGlobal,
  };
};
const info = (extra: Partial<SvnRepoInfo>): SvnRepoInfo => ({
  isWorkingCopy: true,
  ...extra,
});

describe('registerWorkspace', () => {
  it('files a working copy and announces the change', async () => {
    const { storage } = memory();
    const changed = vi.fn();
    window.addEventListener(PROJECTS_CHANGED, changed, { once: true });
    await registerWorkspace(storage, 'C:/a/dev', async () =>
      info({ url: 'svn://h/app/trunk' }),
    );
    expect(loadProjectStore(storage).projects[0].name).toBe('app');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('does not write for non-working copies or missing URLs and swallows errors', async () => {
    const { storage, setGlobal } = memory();
    await registerWorkspace(storage, 'C:/x', async () =>
      info({ isWorkingCopy: false }),
    );
    await registerWorkspace(storage, 'C:/x', async () => info({}));
    await expect(
      registerWorkspace(storage, 'C:/x', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
    expect(setGlobal).not.toHaveBeenCalled();
  });
});
