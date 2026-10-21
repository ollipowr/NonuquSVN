import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { SvnError } from './svn.js';
import { useSvnOperation } from './useSvnOperation.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('retries the captured operation with credentials and refreshes after both attempts', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const appendLog = vi.fn();
  const setBusy = vi.fn();
  const setPill = vi.fn();
  let runner!: ReturnType<typeof useSvnOperation>;
  function Harness() {
    runner = useSvnOperation({ refresh, appendLog, setBusy, setPill });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new SvnError(
          'Authentication failed',
          'svn: E170001: Authentication failed',
          1,
        ),
      )
      .mockResolvedValueOnce('Done');
    await act(async () => {
      await runner.run('Update', operation);
    });
    expect(runner.pendingAuth?.label).toBe('Update');
    expect(refresh).toHaveBeenCalledOnce();
    const credentials = {
      username: 'test',
      password: 'test',
      trustServerCert: false,
    };
    await act(async () => {
      await runner.onAuthSubmit(credentials);
    });
    expect(operation).toHaveBeenLastCalledWith(credentials, appendLog);
    expect(runner.pendingAuth).toBeNull();
    expect(runner.authBusy).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(setPill).toHaveBeenLastCalledWith({ kind: 'success', text: 'Done' });
  } finally {
    await act(async () => root.unmount());
  }
});

it('refreshes after a failed mutation and exposes its error', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const setPill = vi.fn();
  let runner!: ReturnType<typeof useSvnOperation>;
  function Harness() {
    runner = useSvnOperation({
      refresh,
      setPill,
      setBusy: vi.fn(),
      appendLog: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      await runner.run('Commit', async () => {
        throw new Error('Partial add');
      });
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(setPill).toHaveBeenLastCalledWith({
      kind: 'error',
      text: 'Partial add',
    });
    expect(runner.pendingAuth).toBeNull();
    await act(async () => {
      await runner.run('Read', async () => 'Read only', { refresh: false });
    });
    expect(refresh).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
