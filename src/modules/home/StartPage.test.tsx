import { t } from '@nonu/app/i18n';
import type { HostStorage } from '@nonu/host/types';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@nonu/modules/workspace/workspaceStore', () => ({
  getWorkspaceStatus: vi.fn(() => undefined),
  loadWorkspaceStatus: vi.fn(async () => ({
    repo: { isWorkingCopy: true },
    changes: [],
  })),
  checkWorkspaceRemote: vi.fn(async () => undefined),
  useWorkspaceStatusVersion: () => 0,
}));
vi.mock('@nonu/stores', () => ({ loadPersistentSnapshot: () => undefined }));

import { StartPage } from './StartPage.js';

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
  lastOpenedAt: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  projectId,
  name,
  svnUrl: `svn://x/${name}`,
  localPath: `C:/${projectId}/${name}`,
  kind: 'branch',
  lastOpenedAt,
  ...extra,
});
const twoProjects = {
  version: 1,
  projects: [project('a', 'Kundenportal'), project('b', 'Backoffice')],
  workspaces: [
    ws('w1', 'a', 'dev', 5),
    ws('w2', 'a', 'rc', 9),
    ws('w3', 'b', 'prod', 20),
  ],
};

const memory = (initial?: unknown) => {
  const data: Record<string, unknown> = { 'nonuqu.projects.v1': initial };
  const setGlobal = vi.fn(async (k: string, v: unknown) => {
    data[k] = v;
  });
  const storage = {
    get: () => undefined,
    set: async () => {},
    getGlobal: (k: string) => data[k],
    setGlobal,
  } as unknown as HostStorage;
  return { storage, setGlobal, data };
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

const mount = (initial?: unknown, over: Record<string, unknown> = {}) => {
  const m = memory(initial);
  const props = {
    storage: m.storage,
    open: vi.fn(),
    chooseFolder: vi.fn(async () => 'C:/chosen'),
    listSubfolders: vi.fn(async () => []),
    onCheckout: vi.fn(),
    ...over,
  };
  act(() => root.render(<StartPage {...props} />));
  return { ...m, props };
};
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const byText = (selector: string, text: string) =>
  [...container.querySelectorAll(selector)].find((e) =>
    e.textContent?.includes(text),
  );

it('shows one resume card per project, most recently used first', () => {
  mount(twoProjects);
  expect(container.textContent).toContain(t('homeProjectsTitle') as string);
  // "Projekt anlegen" and "Arbeitskopie öffnen"; creating a project and
  // checking out are one action now.
  expect(
    container.querySelectorAll('.svn-home-actions .svn-action-button'),
  ).toHaveLength(2);
  const cards = [...container.querySelectorAll('.svn-home-resume')];
  expect(cards.map((c) => c.textContent)).toEqual([
    expect.stringContaining('Backoffice'),
    expect.stringContaining('Kundenportal'),
  ]);
  expect(cards[1].textContent).toContain('rc');
});

it('opens the resume card working copy and remembers its project', async () => {
  const { props, setGlobal } = mount(twoProjects);
  const open = container.querySelectorAll('.svn-home-resume .svn-btn')[1];
  await click(open);
  expect(setGlobal).toHaveBeenCalledWith(
    'nonuqu.projects.v1',
    expect.objectContaining({ activeProjectId: 'a' }),
  );
  expect(props.open).toHaveBeenCalledWith('C:/a/rc');
});

it('expands the projects of the cards and collapses the others', () => {
  mount({
    ...twoProjects,
    projects: [...twoProjects.projects, project('c', 'Archiv')],
    workspaces: [
      ...twoProjects.workspaces,
      ws('w4', 'c', 'old', 0, { lastOpenedAt: undefined }),
    ],
  });
  const groups = [...container.querySelectorAll('.svn-home-project')];
  const rowsOf = (g: Element) => g.querySelectorAll('.svn-home-row').length;
  expect(rowsOf(groups[0])).toBe(1);
  expect(rowsOf(groups[1])).toBe(2);
  expect(rowsOf(groups[2])).toBe(0);
});

it('shows the empty state with both actions for an empty store', async () => {
  const { props } = mount(undefined);
  expect(container.querySelector('.svn-home-resume')).toBeNull();
  expect(container.textContent).toContain(t('homeEmptyTitle') as string);
  await click(byText('.svn-action-button', t('homeAddOpen') as string));
  expect(props.chooseFolder).toHaveBeenCalled();
  expect(props.open).toHaveBeenCalledWith('C:/chosen');
});

it('hides a working copy from the row context menu', async () => {
  const { setGlobal } = mount(twoProjects);
  const row = byText('.svn-home-row', 'dev')!;
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
  });
  await click(byText('.svn-context-menu-item', t('homeCtxHide') as string));
  const saved = setGlobal.mock.calls.at(-1)![1] as typeof twoProjects;
  expect(saved.workspaces.find((w) => w.id === 'w1')).toMatchObject({
    hidden: true,
  });
});

it('keeps the checkout form instead of the overview when children are given', () => {
  mount(twoProjects, { children: <div className="probe">form</div> });
  expect(container.querySelector('.probe')).not.toBeNull();
  expect(container.querySelector('.svn-home-resume')).toBeNull();
});
