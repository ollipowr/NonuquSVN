import type { HostAdapter } from '@nonu/host/types';
import {
  type BranchEntry,
  fetchBranchStatus,
  fetchEligible,
  fetchMerged,
} from '@nonu/modules/branches';
import { setPanelHost } from '@nonu/stores';
import { runSvn } from '@nonu/svn';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkWorkspaceRemote,
  getWorkspaceStatus,
  invalidateWorkspace,
  loadWorkspaceStatus,
  mergeinfo,
  publishWorkspaceRevision,
  RequestCache,
  remoteBranchStatuses,
} from './workspaceStore.js';

const a = 'C:/work/a';
const b = 'C:/work/b';
const urlA = 'https://example.test/repo/trunk';
const urlB = 'https://example.test/repo/branches/b';
const branch: BranchEntry = {
  id: 'a',
  name: 'A',
  kind: 'trunk',
  localPath: a,
  url: urlA,
};
const exec = vi.fn(async (command: string, options: { cwd: string }) => {
  let stdout = '';
  if (command.includes('"info"'))
    stdout = `URL: ${options.cwd === b ? urlB : urlA}\nRevision: ${command.includes('"HEAD"') ? '12' : '10'}\nRepository Root: https://example.test/repo\n`;
  if (command.includes('"status"'))
    stdout = 'M       tracked.txt\n?       new.txt\nI       ignored.txt\n';
  if (command.includes('"mergeinfo"')) stdout = 'r11\nr12\n';
  return { stdout, stderr: '', exitCode: 0 };
});
const count = (verb: string) =>
  exec.mock.calls.filter(([command]) => command.includes(`"${verb}"`)).length;

beforeEach(() => {
  invalidateWorkspace(a);
  invalidateWorkspace(b);
  mergeinfo.invalidate(() => true);
  remoteBranchStatuses.invalidate(() => true);
  exec.mockClear();
  setPanelHost({ exec } as unknown as HostAdapter);
});

describe('shared workspace status', () => {
  it('shares concurrent Changes/Branches requests and cached Merge status', async () => {
    const [workspace, status] = await Promise.all([
      loadWorkspaceStatus(a, true),
      fetchBranchStatus(branch, a),
    ]);
    expect(workspace.changes).toHaveLength(3);
    expect(status).toMatchObject({
      revision: '10',
      localChanges: 1,
      updateAvailable: true,
    });
    expect(count('status')).toBe(1);
    expect(count('info')).toBe(2); // local info and HEAD
    await fetchBranchStatus(branch, a);
    expect(count('status')).toBe(1);
    expect(count('info')).toBe(2);
    expect(getWorkspaceStatus(a)?.repo.url).toBe(urlA);
    expect(getWorkspaceStatus(a)?.updateAvailable).toBe(true);
  });

  it('shares normalized working-copy paths and loads only missing branches', async () => {
    await fetchBranchStatus(branch, a);
    await fetchBranchStatus(
      { ...branch, id: 'alias', localPath: 'c:\\work\\a\\' },
      a,
    );
    await fetchBranchStatus({ ...branch, id: 'b', localPath: b, url: urlB }, a);
    expect(count('status')).toBe(2);
  });

  it('refreshes status explicitly without fetching it twice concurrently', async () => {
    await loadWorkspaceStatus(a);
    await Promise.all([
      loadWorkspaceStatus(a, true),
      loadWorkspaceStatus(a, true),
    ]);
    expect(count('status')).toBe(2);
  });

  it('does not publish a status request invalidated while running', async () => {
    const pending = loadWorkspaceStatus(a);
    invalidateWorkspace(a);
    await pending;
    expect(getWorkspaceStatus(a)).toBeUndefined();
    await loadWorkspaceStatus(a);
    expect(count('status')).toBe(2);
  });

  it('shares the committed display revision with branch consumers', async () => {
    await loadWorkspaceStatus(a);
    publishWorkspaceRevision(a, '12');
    const status = await fetchBranchStatus(branch, a);
    expect(status.revision).toBe('12');
    expect(status.updateAvailable).toBe(false);
    expect(count('status')).toBe(1);
  });

  it('ignores a remote result for an older revision', async () => {
    const status = await loadWorkspaceStatus(a);
    const pending = checkWorkspaceRemote(a, status.repo);
    publishWorkspaceRevision(a, '12');
    await pending;
    expect(getWorkspaceStatus(a)).toMatchObject({
      revision: '12',
      updateAvailable: false,
    });
  });

  it('does not publish remote results after invalidation', async () => {
    const status = await loadWorkspaceStatus(a);
    const pending = checkWorkspaceRemote(a, status.repo);
    invalidateWorkspace(a);
    await pending;
    expect(getWorkspaceStatus(a)).toBeUndefined();
  });
});

describe('mergeinfo reuse and mutation invalidation', () => {
  it('shares eligible requests across consumers, keeping directions and merged revisions separate', async () => {
    await Promise.all([
      fetchEligible(urlA, urlB, a),
      fetchEligible(urlA, urlB, b),
    ]);
    await fetchEligible(urlA + '/', urlB, a);
    expect(count('mergeinfo')).toBe(1);
    await fetchEligible(urlB, urlA, a);
    await fetchMerged(urlA, urlB, a);
    expect(count('mergeinfo')).toBe(3);
  });

  it.each(['update', 'merge', 'commit', 'switch'])(
    'invalidates affected status and both pair directions after %s',
    async (verb) => {
      await Promise.all([loadWorkspaceStatus(a), loadWorkspaceStatus(b)]);
      await fetchEligible(urlA, urlB, a);
      await fetchEligible(urlB, urlA, a);
      await fetchEligible(
        'https://example.test/other/x',
        'https://example.test/other/y',
        a,
      );
      await runSvn([verb], a);
      expect(getWorkspaceStatus(a)).toBeUndefined();
      expect(getWorkspaceStatus(b)).toBeDefined();
      await loadWorkspaceStatus(b);
      await loadWorkspaceStatus(a);
      expect(count('status')).toBe(3);
      await fetchEligible(urlA, urlB, a);
      await fetchEligible(urlB, urlA, a);
      await fetchEligible(
        'https://example.test/other/x',
        'https://example.test/other/y',
        a,
      );
      expect(count('mergeinfo')).toBe(5);
    },
  );

  it('keeps caches for a dry run', async () => {
    const status = await loadWorkspaceStatus(a);
    await fetchEligible(urlA, urlB, a);
    await runSvn(['merge', '--dry-run', urlB], a);
    expect(getWorkspaceStatus(a)).toBe(status);
    await fetchEligible(urlA, urlB, a);
    expect(count('mergeinfo')).toBe(1);
  });

  it('invalidates both old and new switch URLs without flushing unrelated pairs', async () => {
    await loadWorkspaceStatus(a);
    await fetchEligible(urlA, urlB, a);
    await fetchEligible(urlB, 'https://example.test/new', a);
    await runSvn(['switch', 'https://example.test/new'], a);
    await fetchEligible(urlA, urlB, a);
    await fetchEligible(urlB, 'https://example.test/new', a);
    expect(count('mergeinfo')).toBe(4);
  });

  it('invalidates after a partially failed mutation too', async () => {
    await loadWorkspaceStatus(a);
    exec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'Update failed',
      exitCode: 1,
    });
    await expect(runSvn(['update'], a)).rejects.toThrow('Update failed');
    expect(getWorkspaceStatus(a)).toBeUndefined();
  });
});

describe('request lifecycle', () => {
  it('does not restore invalidated entries when an old request finishes', async () => {
    const cache = new RequestCache<number>();
    let resolve!: (value: number) => void;
    const old = cache.load(
      'key',
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    await Promise.resolve();
    cache.invalidate(() => true);
    await cache.load('key', async () => 2);
    resolve(1);
    await old;
    expect(cache.peek('key')).toBe(2);
  });

  it('retries failures instead of caching them', async () => {
    const cache = new RequestCache<number>();
    await expect(
      cache.load('key', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await cache.load('key', async () => 2)).toBe(2);
  });
});
