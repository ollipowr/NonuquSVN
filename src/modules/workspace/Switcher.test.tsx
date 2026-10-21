import type { ProjectStore } from '@nonu/modules/projects/projects';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { Switcher } from './Switcher.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const project = (id: string, name: string) => ({
  id,
  name,
  workspaceIds: [],
  createdAt: 0,
  updatedAt: 0,
});
const ws = (
  id: string,
  projectId: string,
  name: string,
  localPath: string,
) => ({
  id,
  projectId,
  name,
  svnUrl: `svn://x/${name}`,
  localPath,
  kind: 'branch' as const,
});
const store: ProjectStore = {
  version: 1,
  projects: [project('p1', 'Kundenportal')],
  workspaces: [
    ws('w1', 'p1', 'dev', 'C:/a/dev'),
    ws('w2', 'p1', 'rc', 'C:/a/rc'),
  ],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

const mount = (props: Partial<React.ComponentProps<typeof Switcher>> = {}) => {
  const p = {
    store,
    currentPath: 'C:/a/dev',
    onSelect: vi.fn(),
    onStart: vi.fn(),
    ...props,
  };
  act(() =>
    root.render(
      <div>
        <Switcher {...p} />
      </div>,
    ),
  );
  act(() =>
    container.querySelector<HTMLButtonElement>('.svn-select-trigger')!.click(),
  );
  return p;
};

it('selects the row under the cursor with ArrowDown and Enter', () => {
  const p = mount();
  const input = container.querySelector('[role="listbox"]')!;
  key(input, 'ArrowDown');
  key(input, 'Enter');
  expect(p.onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'w2', localPath: 'C:/a/rc' }),
  );
});

it('closes on Escape', () => {
  const p = mount();
  key(container.querySelector('[role="listbox"]')!, 'Escape');
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('.svn-select-trigger'),
  );
});

it('shows an empty hint and still offers Start for an empty store', () => {
  const p = mount({ store: { version: 1, projects: [], workspaces: [] } });
  expect(container.querySelector('.svn-select-empty')).not.toBeNull();
  act(() =>
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        '.svn-menu-popup > button',
      ),
    ][0].click(),
  );
  expect(p.onStart).toHaveBeenCalled();
});

it('marks the open working copy as current', () => {
  mount();
  expect(
    container.querySelector('.svn-select-panel-head')?.textContent,
  ).toContain('Branch wechseln');
  expect(
    container.querySelector('.svn-select-popup')?.textContent,
  ).not.toContain('C:/a/');
  expect(
    container.querySelector('[role="option"][aria-selected="true"]')
      ?.textContent,
  ).toContain('dev');
});
