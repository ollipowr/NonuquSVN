import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DiffView, type DiffViewHandle } from './DiffView.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const text = '@@ -1,4 +1,4 @@\n-old\n+new\n same\n-removed\n+added\n end';

describe('DiffView interactions', () => {
  for (const mode of ['inline', 'split'] as const) {
    it(`advances and reverses through distinct blocks in ${mode} mode without relying on scroll position`, async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const ref = createRef<DiffViewHandle>();
      try {
        await act(async () =>
          root.render(
            React.createElement(DiffView, {
              text,
              path: 'test.txt',
              mode,
              ref,
            }),
          ),
        );
        const focused = () =>
          Array.from(
            container.querySelectorAll('.svn-change-focus .svn-code-text'),
          ).map((el) => el.textContent);
        ref.current!.jump('next');
        expect(focused()).toEqual(['old', 'new']);
        ref.current!.jump('next');
        expect(focused()).toEqual(['removed', 'added']);
        ref.current!.jump('prev');
        expect(focused()).toEqual(['old', 'new']);
        ref.current!.jump('prev');
        expect(focused()).toEqual(['removed', 'added']);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  }

  it('resizes split panes and stops resizing after mouseup', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(DiffView, {
            text,
            path: 'test.txt',
            mode: 'split',
          }),
        ),
      );
      const body = container.querySelector<HTMLElement>('.svn-diff-resizable')!;
      body.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
      const splitter = container.querySelector('.svn-splitter')!;
      await act(async () => {
        splitter.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 500 }),
        );
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }));
      });
      expect(body.style.getPropertyValue('--svn-diff-left')).toBe('70');
      await act(async () => {
        window.dispatchEvent(new MouseEvent('mouseup'));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      });
      expect(body.style.getPropertyValue('--svn-diff-left')).toBe('70');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('synchronizes split scrolling by default and can unlink the panes', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(DiffView, {
            text,
            path: 'test.txt',
            mode: 'split',
          }),
        ),
      );
      const panes = container.querySelectorAll<HTMLElement>('.svn-split-pane');
      panes[0].scrollTop = 120;
      await act(async () => panes[0].dispatchEvent(new Event('scroll')));
      expect(panes[1].scrollTop).toBe(120);

      await act(async () =>
        root.render(
          React.createElement(DiffView, {
            text,
            path: 'test.txt',
            mode: 'split',
            syncScroll: false,
          }),
        ),
      );
      panes[0].scrollTop = 240;
      await act(async () => panes[0].dispatchEvent(new Event('scroll')));
      expect(panes[1].scrollTop).toBe(120);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('can hide hunk markers and show revision headers in split mode', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(DiffView, {
            text,
            path: 'test.txt',
            mode: 'split',
            hideHunks: true,
            splitHeaders: { old: 'test.txt · r42', new: 'test.txt · r43' },
          }),
        ),
      );
      expect(container.textContent).not.toContain('@@ -1,4 +1,4 @@');
      expect(
        Array.from(container.querySelectorAll('.svn-diff-pane-head')).map(
          (el) => el.textContent,
        ),
      ).toEqual(['test.txt · r42', 'test.txt · r43']);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows only the applicable line number in each split pane', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          React.createElement(DiffView, {
            text,
            path: 'test.txt',
            mode: 'split',
          }),
        ),
      );
      const oldLine = container.querySelector(
        '.svn-split-pane:first-child .svn-diff-del',
      )!;
      const newLine = container.querySelector(
        '.svn-split-pane:last-child .svn-diff-add',
      )!;
      expect(oldLine.querySelectorAll('.svn-ln')).toHaveLength(1);
      expect(newLine.querySelectorAll('.svn-ln')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
