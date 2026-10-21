import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { type GroupRow, ProjectGroup } from './ProjectGroup.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const project = {
  id: 'p',
  name: 'Kundenportal',
  workspaceIds: [],
  createdAt: 0,
  updatedAt: 0,
};
const row = (
  id: string,
  name: string,
  extra: Partial<GroupRow> = {},
): GroupRow => ({
  workspace: {
    id,
    projectId: 'p',
    name,
    svnUrl: `svn://x/${name}`,
    localPath: `C:/${name}`,
    kind: 'branch',
  },
  current: false,
  ...extra,
});
const clean = {
  missing: false,
  dirty: 0,
  conflicts: 0,
  update: false,
  clean: true,
};
const dirty = { ...clean, clean: false, dirty: 3, update: true };

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

const mount = (
  props: Partial<React.ComponentProps<typeof ProjectGroup>> = {},
) => {
  const p = {
    project,
    rows: [
      row('1', 'dev', { badges: clean, revision: '10' }),
      row('2', 'rc', { badges: dirty, current: true }),
    ],
    hiddenCount: 0,
    showHidden: false,
    expanded: true,
    renaming: false,
    busy: false,
    onToggle: vi.fn(),
    onToggleHidden: vi.fn(),
    onOpen: vi.fn(),
    onRowMenu: vi.fn(),
    onProjectMenu: vi.fn(),
    onRename: vi.fn(),
    onRenameCancel: vi.fn(),
    ...props,
  };
  act(() => root.render(<ProjectGroup {...p} />));
  return p;
};

it('opens the clicked working copy and marks the current one', () => {
  const p = mount();
  const rows = container.querySelectorAll<HTMLButtonElement>('.svn-home-row');
  expect(rows).toHaveLength(2);
  expect(rows[1].className).toContain('svn-home-row--current');
  act(() => rows[0].click());
  expect(p.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
});

it('shows the revision and badges of a row', () => {
  mount();
  const first = container.querySelectorAll('.svn-home-row')[0];
  expect(first.textContent).toContain('r10');
  expect(container.querySelector('.svn-home-badge--ok')).not.toBeNull();
  expect(
    container.querySelector('.svn-home-badge--dirty')?.textContent,
  ).toContain('3');
  expect(container.querySelector('.svn-home-badge--update')).not.toBeNull();
});

it('hides the rows but shows a summary when collapsed', () => {
  mount({ expanded: false });
  expect(container.querySelectorAll('.svn-home-row')).toHaveLength(0);
  expect(container.querySelector('.svn-home-summary')?.textContent).toContain(
    '3',
  );
});

it('offers the hidden working copies and toggles them', () => {
  const p = mount({ hiddenCount: 2 });
  const more = container.querySelector<HTMLButtonElement>('.svn-home-more')!;
  expect(more.textContent).toContain('2');
  act(() => more.click());
  expect(p.onToggleHidden).toHaveBeenCalled();
});

it('renames with Enter and cancels with Escape', () => {
  const p = mount({ renaming: true });
  const input = container.querySelector<HTMLInputElement>('.svn-home-rename')!;
  expect(input.value).toBe('Kundenportal');
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  });
  expect(p.onRename).toHaveBeenCalledWith('Kundenportal');
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  expect(p.onRenameCancel).toHaveBeenCalled();
});

it('does not open a working copy whose folder is missing', () => {
  const p = mount({
    rows: [
      row('1', 'gone', { badges: { ...clean, clean: false, missing: true } }),
    ],
  });
  const button = container.querySelector<HTMLButtonElement>('.svn-home-row')!;
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(p.onOpen).not.toHaveBeenCalled();
});
