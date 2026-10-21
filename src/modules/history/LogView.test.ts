import { t } from '@nonu/app/i18n';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LogView } from './LogView.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('loads on a single click, ignores stale diffs, and passes revision context to history actions', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let resolveFirst!: (value: string) => void;
  const loadDiff = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce('second diff');
  const onOpenFile = vi.fn();
  const onLogFile = vi.fn();
  const onBlameFile = vi
    .fn()
    .mockRejectedValue(new Error('Visible action error'));
  try {
    await act(async () =>
      root.render(
        React.createElement(LogView, {
          diffMode: 'inline',
          onDiffModeChange: vi.fn(),
          loadDiff,
          load: async () => [
            {
              revision: '42',
              author: 'tester',
              date: '',
              message: 'test',
              paths: [
                { path: '/trunk/first.ts', action: 'M' },
                { path: '/trunk/second.ts', action: 'D' },
              ],
            },
          ],
          onOpenFile,
          onShowInExplorer: vi.fn(),
          onLogFile,
          onBlameFile,
        }),
      ),
    );
    const files = container.querySelectorAll('.svn-log-file');
    await act(async () =>
      files[0].dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(loadDiff).toHaveBeenCalledWith('42', '/trunk/first.ts', 'M');
    await act(async () =>
      files[1].dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await act(async () => resolveFirst('stale first diff'));
    expect(container.querySelector('.svn-diff-body')?.textContent).toContain(
      'second diff',
    );
    expect(
      container.querySelector('.svn-diff-body')?.textContent,
    ).not.toContain('stale first diff');

    const menuAction = async (label: string) => {
      await act(async () =>
        files[1].dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true }),
        ),
      );
      const button = Array.from(document.querySelectorAll('button')).find(
        (el) => el.textContent?.includes(label),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    await menuAction(t('ctxOpenFile') as string);
    expect(onOpenFile).toHaveBeenCalledWith('/trunk/second.ts');
    await menuAction(t('ctxLogForFile') as string);
    expect(onLogFile).toHaveBeenCalledWith('/trunk/second.ts', '42', 'D');
    await menuAction(t('ctxBlame') as string);
    expect(onBlameFile).toHaveBeenCalledWith('/trunk/second.ts', '42', 'D');
    expect(container.textContent).toContain('Visible action error');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows revision, date, and author above both split diff panes', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const current = {
    revision: '43',
    author: 'new-author',
    date: '2026-10-10T12:00:00Z',
    message: 'test',
    paths: [{ path: '/trunk/base23.css', action: 'M' }],
  };
  const previous = {
    revision: '42',
    author: 'old-author',
    date: '2026-10-09T12:00:00Z',
    message: '',
    paths: [],
  };
  const load = vi.fn(async ({ revision }: { revision?: string }) =>
    revision === '42' ? [previous] : [current],
  );
  try {
    await act(async () =>
      root.render(
        React.createElement(LogView, {
          diffMode: 'split',
          onDiffModeChange: vi.fn(),
          load,
          loadDiff: async () =>
            'Index: base23.css\r\n===================================================================\r\n--- base23.css (revision 42)\r\n+++ base23.css (revision 43)\r\n@@ -1 +1 @@\r\n-old\r\n+new',
          onOpenFile: vi.fn(),
          onShowInExplorer: vi.fn(),
          onLogFile: vi.fn(),
          onBlameFile: vi.fn(),
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.svn-log-file')!.click(),
    );
    expect(container.textContent).not.toContain('@@ -1 +1 @@');
    expect(container.textContent).not.toContain('Index: base23.css');
    expect(container.textContent).not.toContain(
      '===================================================================',
    );
    expect(container.textContent).not.toContain('--- base23.css (revision 42)');
    expect(
      Array.from(container.querySelectorAll('.svn-diff-pane-head')).map(
        (el) => el.textContent,
      ),
    ).toEqual([
      `r42 · ${new Date(previous.date).toLocaleString()} · old-author`,
      `r43 · ${new Date(current.date).toLocaleString()} · new-author`,
    ]);
    expect(load).toHaveBeenCalledWith({ revision: '42', limit: 1 });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
