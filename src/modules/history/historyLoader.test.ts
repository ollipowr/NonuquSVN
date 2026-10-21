import { runSvn, svnCat } from '@nonu/svn';
import { beforeEach, expect, it, vi } from 'vitest';

import {
  loadFileBlame,
  loadFileHistory,
  loadHistory,
} from './historyLoader.js';

vi.mock('@nonu/svn', () => ({
  runSvn: vi.fn(),
  svnCat: vi.fn(),
  parseSvnLog: () => [],
  parseSvnBlame: () => [],
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runSvn).mockResolvedValue({ stdout: '', stderr: '' });
  vi.mocked(svnCat).mockResolvedValue('');
});

it('retains date bounds and paging limits', async () => {
  await loadHistory('wc', {
    before: '20',
    from: '2026-01-01',
    limit: 100,
    verbose: true,
  });
  expect(runSvn).toHaveBeenCalledWith(
    ['log', '--xml', '-v', '-r', '19:{2026-01-01T00:00:00}', '-l', '100'],
    'wc',
  );
});

it('preserves file identity at the caller-provided peg revision', async () => {
  await loadFileHistory('wc', '^/trunk/deleted.txt@9', '10');
  expect(runSvn).toHaveBeenCalledWith(
    ['log', '-l', '50', '--xml', '-r', '10:1', '^/trunk/deleted.txt@9'],
    'wc',
  );
});

it('loads historical blame and content at the same explicit revision', async () => {
  await loadFileBlame('wc', '^/trunk/deleted.txt@9', '9');
  expect(runSvn).toHaveBeenCalledWith(
    ['blame', '--xml', '-r', '9', '^/trunk/deleted.txt@9'],
    'wc',
  );
  expect(runSvn).toHaveBeenCalledWith(
    ['cat', '-r', '9', '^/trunk/deleted.txt@9'],
    'wc',
  );
  expect(svnCat).not.toHaveBeenCalled();
});

it('loads project history from its URL and branch history from the local working copy', async () => {
  await loadHistory(
    'wc',
    { limit: 100, verbose: true },
    'svn://example/project',
  );
  expect(runSvn).toHaveBeenLastCalledWith(
    ['log', '--xml', '-v', '-l', '100', 'svn://example/project'],
    'wc',
  );
  await loadHistory('wc', { limit: 100, verbose: true });
  expect(runSvn).toHaveBeenLastCalledWith(
    ['log', '--xml', '-v', '-l', '100'],
    'wc',
  );
});
