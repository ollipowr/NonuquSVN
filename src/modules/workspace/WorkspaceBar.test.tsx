import type { HostStorage } from '@nonu/host/types';
import { PROJECT_STORE_KEY } from '@nonu/modules/projects/projects';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { WorkspaceBar } from './WorkspaceBar.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const store = {
  version: 1,
  activeProjectId: 'p1',
  projects: [
    {
      id: 'p1',
      name: 'Kundenportal',
      workspaceIds: ['w1', 'w2'],
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  workspaces: [
    {
      id: 'w1',
      projectId: 'p1',
      name: 'dev',
      svnUrl: 'svn://x/dev',
      localPath: 'C:/a/dev',
      kind: 'trunk',
    },
    {
      id: 'w2',
      projectId: 'p1',
      name: 'rc',
      svnUrl: 'svn://x/rc',
      localPath: 'C:/a/rc',
      kind: 'branch',
    },
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

const mount = (storage: HostStorage, workspace = 'C:/a/dev') => {
  const onStart = vi.fn();
  act(() =>
    root.render(<WorkspaceBar workspace={workspace} storage={storage} />),
  );
  return { onStart };
};

it('shows project / branch and contains no search input or shortcut', () => {
  mount({
    getGlobal: (k: string) => (k === PROJECT_STORE_KEY ? store : undefined),
  } as unknown as HostStorage);
  expect(container.textContent).toContain('Kundenportal');
  expect(container.textContent).toContain('Aktuelles Projekt');
  expect(container.textContent).toContain('Aktueller Branch');
  expect(
    container.querySelector('.svn-workspace-project-select .svn-select-label')
      ?.textContent,
  ).toBe('Kundenportal');
  expect(
    container.querySelector('.svn-workspace-select .svn-select-label')
      ?.textContent,
  ).toBe('dev');
  expect(container.querySelector('input')).toBeNull();
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    ),
  );
  expect(container.querySelector('.svn-switcher')).toBeNull();
});
it('selects a local copy with the keyboard and restores trigger focus', () => {
  mount({
    getGlobal: (k: string) => (k === PROJECT_STORE_KEY ? store : undefined),
  } as unknown as HostStorage);
  const opened = vi.fn();
  const listener = (e: Event) => opened((e as CustomEvent).detail);
  window.addEventListener('svn-open-path', listener);
  try {
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '.svn-workspace-select .svn-select-trigger',
        )!
        .click(),
    );
    const list = container.querySelector(
      '.svn-workspace-select [role="listbox"]',
    )!;
    act(() =>
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    );
    act(() =>
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    );
    expect(opened).toHaveBeenCalledWith({
      path: 'C:/a/rc',
      preserveView: true,
    });
    expect(document.activeElement).toBe(
      container.querySelector('.svn-workspace-select .svn-select-trigger'),
    );
    expect(container.querySelector('input')).toBeNull();
  } finally {
    window.removeEventListener('svn-open-path', listener);
  }
});
it('uses a primary Update button and the existing unsaved guard', () => {
  const update = vi.fn();
  let proceed: (() => void) | undefined;
  const chrome = {
    busy: false,
    update,
    guard: (next: () => void) => {
      proceed = next;
    },
  } as unknown as import('./WorkspaceView').WorkspaceChrome;
  act(() =>
    root.render(
      <WorkspaceBar
        workspace="C:/a/dev"
        storage={
          {
            getGlobal: (k: string) =>
              k === PROJECT_STORE_KEY ? store : undefined,
          } as unknown as HostStorage
        }
        chrome={chrome}
      />,
    ),
  );
  act(() =>
    container.querySelector<HTMLButtonElement>('.svn-btn--primary')!.click(),
  );
  expect(update).not.toHaveBeenCalled();
  act(() => proceed?.());
  expect(update).toHaveBeenCalledOnce();
});

it('switches projects and exposes project and worktree actions', () => {
  const onAddProject = vi.fn();
  const onOpenWorkingCopy = vi.fn();
  const secondProject = {
    id: 'p2',
    name: 'Website',
    workspaceIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const storage = {
    getGlobal: (k: string) =>
      k === PROJECT_STORE_KEY
        ? { ...store, projects: [...store.projects, secondProject] }
        : undefined,
  } as unknown as HostStorage;
  const opened = vi.fn();
  const listener = (e: Event) => opened((e as CustomEvent).detail);
  window.addEventListener('svn-open-project', listener);
  try {
    act(() =>
      root.render(
        <WorkspaceBar
          workspace="C:/a/dev"
          storage={storage}
          onAddProject={onAddProject}
          onOpenWorkingCopy={onOpenWorkingCopy}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '.svn-workspace-project-select .svn-select-trigger',
        )!
        .click(),
    );
    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '.svn-workspace-project-select [role="option"]',
        ),
      )
        .find((option) => option.textContent?.includes('Website'))!
        .click(),
    );
    expect(opened).toHaveBeenCalledWith({ projectId: 'p2' });
    expect(
      container.querySelector(
        '.svn-workspace-project-select .svn-select-panel-head',
      ),
    ).toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '.svn-workspace-project-select .svn-select-trigger',
        )!
        .click(),
    );
    expect(
      container.querySelector(
        '.svn-workspace-project-select .svn-select-panel-head',
      )?.textContent,
    ).toContain('Projekt wechseln');
    expect(
      container.querySelector('.svn-workspace-project-select .svn-select-popup')
        ?.textContent,
    ).not.toContain('svn://');
    expect(
      container.querySelector('.svn-workspace-project-select .svn-select-popup')
        ?.textContent,
    ).toContain('2 Arbeitskopien');
    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '.svn-workspace-project-select .svn-menu-popup button',
        ),
      )
        .find((button) => button.textContent?.includes('Projekt anlegen'))!
        .click(),
    );
    expect(onAddProject).toHaveBeenCalledOnce();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '.svn-workspace-select .svn-select-trigger',
        )!
        .click(),
    );
    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '.svn-workspace-select .svn-menu-popup button',
        ),
      )
        .find((button) =>
          button.textContent?.includes('Arbeitskopie hinzufügen'),
        )!
        .click(),
    );
    expect(onOpenWorkingCopy).toHaveBeenCalledOnce();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '.svn-workspace-select .svn-select-trigger',
        )!
        .click(),
    );
    expect(container.textContent).not.toContain('Branches verwalten');
    expect(container.querySelector('.svn-workspace-manage')).toBeNull();
  } finally {
    window.removeEventListener('svn-open-project', listener);
  }
});

it('opens merge from the working-copy header and disables it while busy', () => {
  const openMerge = vi.fn();
  const storage = {
    getGlobal: (key: string) => (key === PROJECT_STORE_KEY ? store : undefined),
  } as unknown as HostStorage;
  const chrome = {
    busy: false,
    mergeAvailable: true,
    openMerge,
  } as unknown as import('./WorkspaceView.js').WorkspaceChrome;
  const render = () =>
    act(() =>
      root.render(
        <WorkspaceBar workspace="C:/a/dev" storage={storage} chrome={chrome} />,
      ),
    );
  render();
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.includes('Mergen'),
  )!;
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(openMerge).toHaveBeenCalledOnce();
  chrome.busy = true;
  render();
  expect(button.disabled).toBe(true);
});

it('replaces Update with an outlined non-actionable current status', () => {
  const update = vi.fn();
  const storage = {
    getGlobal: (key: string) => (key === PROJECT_STORE_KEY ? store : undefined),
  } as unknown as HostStorage;
  const chrome = {
    busy: false,
    updateAvailable: false,
    update,
  } as unknown as import('./WorkspaceView.js').WorkspaceChrome;
  act(() =>
    root.render(
      <WorkspaceBar workspace="C:/a/dev" storage={storage} chrome={chrome} />,
    ),
  );
  const button = container.querySelector<HTMLButtonElement>(
    '.svn-workspace-up-to-date',
  )!;
  expect(button.textContent).toContain('Aktuell');
  expect(
    button.querySelector('.material-symbols-outlined')?.textContent?.trim(),
  ).toBe('check');
  expect(button.classList.contains('svn-btn--primary')).toBe(false);
  expect(button.disabled).toBe(true);
  act(() => button.click());
  expect(update).not.toHaveBeenCalled();
  chrome.updateAvailable = true;
  act(() =>
    root.render(
      <WorkspaceBar workspace="C:/a/dev" storage={storage} chrome={chrome} />,
    ),
  );
  expect(container.querySelector('.svn-workspace-up-to-date')).toBeNull();
  expect(
    container.querySelector<HTMLButtonElement>(
      '.svn-titlebar-btn.svn-btn--primary',
    )?.disabled,
  ).toBe(false);
});
it('allows merge for a loose working copy absent from the project switcher', () => {
  const openMerge = vi.fn();
  const storage = {
    getGlobal: (key: string) => (key === PROJECT_STORE_KEY ? store : undefined),
  } as unknown as HostStorage;
  const chrome = {
    busy: false,
    mergeAvailable: true,
    openMerge,
  } as unknown as import('./WorkspaceView.js').WorkspaceChrome;
  act(() =>
    root.render(
      <WorkspaceBar workspace="C:/loose" storage={storage} chrome={chrome} />,
    ),
  );
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.includes('Mergen'),
  )!;
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(openMerge).toHaveBeenCalledOnce();
});
