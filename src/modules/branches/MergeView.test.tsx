import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MergeView } from './MergeView.js';

vi.mock('./branches.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./branches.js')>()),
  fetchBranchStatus: vi.fn(async () => ({
    updateAvailable: false,
    localChanges: 0,
  })),
}));

it('accepts a source URL without branch management and rejects the target itself', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MergeView
          registry={{
            entries: [
              {
                id: 'target',
                name: 'feature',
                url: 'svn://example/feature',
                localPath: 'C:/feature',
                kind: 'branch',
              },
            ],
            roots: [],
          }}
          cwd="C:/feature"
          defaultTargetId="target"
          run={vi.fn()}
          onClose={vi.fn()}
          onMerged={vi.fn()}
        />,
      ),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[placeholder]')!;
    expect(input).not.toBeNull();
    const next = () =>
      container.querySelector<HTMLButtonElement>(
        '.svn-merge-action-buttons .svn-btn--primary',
      )!;
    expect(next().disabled).toBe(true);
    const enter = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await enter('svn://example/trunk');
    expect(next().disabled).toBe(false);
    await enter('svn://example/feature/');
    expect(next().disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('allows changing the target and swapping two local working copies', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <MergeView
          registry={{
            entries: [
              {
                id: 'trunk',
                name: 'trunk',
                url: 'svn://example/trunk',
                localPath: 'C:/trunk',
                kind: 'trunk',
              },
              {
                id: 'feature',
                name: 'feature',
                url: 'svn://example/feature',
                localPath: 'C:/feature',
                kind: 'branch',
              },
            ],
            roots: [],
          }}
          cwd="C:/feature"
          defaultTargetId="feature"
          run={vi.fn()}
          onClose={vi.fn()}
          onMerged={vi.fn()}
        />,
      ),
    );
    const selects = container.querySelectorAll<HTMLButtonElement>(
      '.svn-merge-direction .svn-select-trigger',
    );
    expect(selects[1].disabled).toBe(false);
    const swap = container.querySelector<HTMLButtonElement>(
      '.svn-merge-arrow button',
    )!;
    expect(swap.disabled).toBe(false);
    await act(async () => swap.click());
    expect(
      container.querySelector('.svn-merge-context strong')?.textContent,
    ).toBe('feature → trunk');
    expect(
      container.querySelector('.svn-merge-context span')?.textContent,
    ).toContain('C:/trunk');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
