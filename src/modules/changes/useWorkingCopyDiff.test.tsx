import type { DiffCacheEntry } from '@nonu/stores';
import { runSvn } from '@nonu/svn';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { diffCacheEntryKey, useWorkingCopyDiff } from './useWorkingCopyDiff.js';

vi.mock('@nonu/svn', () => ({
  runSvn: vi.fn(),
  SvnError: class extends Error {},
}));
vi.mock('@nonu/stores', () => ({ readFileRaw: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows a cached diff immediately and ignores an older request after changing files', async () => {
  let finishOld!: (value: { stdout: string; stderr: string }) => void;
  vi.mocked(runSvn)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockResolvedValueOnce({ stdout: 'new diff', stderr: '' });
  const cached = { text: 'cached diff', isNewFile: false };
  const cache = {
    current: new Map<string, DiffCacheEntry>([
      [diffCacheEntryKey('old', 'modified'), cached],
    ]),
  };
  let state!: ReturnType<typeof useWorkingCopyDiff>;
  function Harness({ active }: { active: string }) {
    state = useWorkingCopyDiff({
      cwd: 'wc',
      active,
      activeStatus: 'modified',
      refreshTick: 0,
      hasLoaded: true,
      initialDiff: cached,
      diffCacheRef: cache,
    });
    return <div>{state.diff}</div>;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness active="old" />));
    expect(state.diff).toBe('cached diff');
    await act(async () => root.render(<Harness active="new" />));
    expect(state.diff).toBe('new diff');
    await act(async () => finishOld({ stdout: 'stale diff', stderr: '' }));
    expect(state.diff).toBe('new diff');
    expect(cache.current.get(diffCacheEntryKey('old', 'modified'))?.text).toBe(
      'cached diff',
    );
  } finally {
    await act(async () => root.unmount());
  }
});
