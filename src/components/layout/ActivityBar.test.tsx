import type { HostStorage } from '@nonu/host/types';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  ActivityBar,
  type ActivityView,
  useNavExpanded,
} from './ActivityBar.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

const view = (
  id: string,
  extra: Partial<ActivityView<string>> = {},
): ActivityView<string> => ({
  id,
  icon: 'x',
  label: id.toUpperCase(),
  ...extra,
});

it('draws one separator where the group changes', () => {
  act(() =>
    root.render(
      <ActivityBar
        views={[
          view('a', { group: 'one' }),
          view('b', { group: 'one' }),
          view('c', { group: 'two' }),
        ]}
        active="a"
        onChange={() => {}}
      />,
    ),
  );
  expect(container.querySelectorAll('.svn-ab-sep')).toHaveLength(1);
  const children = [...container.querySelector('nav')!.children];
  expect(children[2].className).toBe('svn-ab-sep');
});

it('draws no separator without groups', () => {
  act(() =>
    root.render(
      <ActivityBar
        views={[view('a'), view('b')]}
        active="a"
        onChange={() => {}}
      />,
    ),
  );
  expect(container.querySelectorAll('.svn-ab-sep')).toHaveLength(0);
});

it('does not switch to a disabled view and shows its hint', () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <ActivityBar
        views={[
          view('a'),
          view('b', { disabled: true, disabledTitle: 'Nicht verfügbar' }),
        ]}
        active="a"
        onChange={onChange}
      />,
    ),
  );
  const b = container.querySelector<HTMLButtonElement>(
    'button[aria-label="B"]',
  )!;
  expect(b.disabled).toBe(true);
  expect(b.title).toBe('Nicht verfügbar');
  act(() => b.click());
  expect(onChange).not.toHaveBeenCalled();
});

function NavToggle({ storage }: { storage: HostStorage }) {
  const nav = useNavExpanded(storage);
  return (
    <>
      <button aria-expanded={nav.expanded} onClick={nav.toggle} />
      {nav.error && <span role="alert">{nav.error}</span>}
    </>
  );
}

it('keeps the navigation state shared and restores it after remount', async () => {
  let saved = false;
  const setGlobal = vi.fn(async (_key: string, value: unknown) => {
    saved = value as boolean;
  });
  const storage = {
    getGlobal: () => saved,
    setGlobal,
  } as unknown as HostStorage;
  const onChange = vi.fn();
  const render = () => (
    <>
      <NavToggle storage={storage} />
      <ActivityBar
        storage={storage}
        projectName="Portal"
        views={[view('a', { badge: 3, group: 'projects' })]}
        active="a"
        onChange={onChange}
      />
    </>
  );
  act(() => root.render(render()));
  expect(container.querySelector('.svn-ab--collapsed')).not.toBeNull();
  act(() =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="A"]')!
      .click(),
  );
  expect(onChange).toHaveBeenCalledWith('a');
  expect(container.querySelector('.svn-ab-badge')?.textContent).toBe('3');
  act(() => root.render(<div />));
  act(() => root.render(render()));
  expect(container.querySelector('.svn-ab--collapsed')).not.toBeNull();
});

it('expands every navigation bar when the shared toggle is pressed', async () => {
  let saved = false;
  const setGlobal = vi.fn(async (_key: string, value: unknown) => {
    saved = value as boolean;
  });
  const storage = {
    getGlobal: () => saved,
    setGlobal,
  } as unknown as HostStorage;
  act(() =>
    root.render(
      <>
        <NavToggle storage={storage} />
        <ActivityBar
          storage={storage}
          views={[view('a')]}
          active="a"
          onChange={() => {}}
        />
      </>,
    ),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-expanded]')!
      .click(),
  );
  expect(setGlobal).toHaveBeenCalledWith('nonuqu.navigation.expanded', true);
  expect(container.querySelector('.svn-ab--collapsed')).toBeNull();
});

it('retains the previous toggle state on a storage failure', async () => {
  const storage = {
    getGlobal: () => true,
    setGlobal: vi.fn().mockRejectedValue(new Error('disk full')),
  } as unknown as HostStorage;
  act(() => root.render(<NavToggle storage={storage} />));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-expanded]')!
      .click(),
  );
  expect(
    container
      .querySelector('button[aria-expanded]')
      ?.getAttribute('aria-expanded'),
  ).toBe('true');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'disk full',
  );
});

it('moves keyboard focus and activates enabled tabs with arrow keys', () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <ActivityBar
        views={[view('a'), view('b', { disabled: true }), view('c')]}
        active="a"
        onChange={onChange}
      />,
    ),
  );
  const tab = container.querySelector<HTMLButtonElement>(
    'button[aria-label="A"]',
  )!;
  act(() => {
    tab.focus();
    tab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
  });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('C');
  expect(onChange).toHaveBeenCalledWith('c');
});

it('renders named project and branch groups without changing the tab order when collapsed', async () => {
  const views = [
    view('projects', { group: 'global' }),
    view('overview', { group: 'projects' }),
    view('changes', { group: 'workspace' }),
  ];
  const storage = {
    getGlobal: () => false,
    setGlobal: vi.fn(),
  } as unknown as HostStorage;
  act(() =>
    root.render(
      <ActivityBar
        storage={storage}
        projectName="Portal"
        branchName="trunk"
        views={views}
        active="changes"
        onChange={() => {}}
      />,
    ),
  );
  expect(
    [...container.querySelectorAll('.svn-ab-heading')].map(
      (el) => el.textContent,
    ),
  ).toEqual(['Projekt - Portal']);
  expect(
    [...container.querySelectorAll('[role="tab"]')].map((el) =>
      el.getAttribute('aria-label'),
    ),
  ).toEqual(['PROJECTS', 'OVERVIEW', 'CHANGES']);
  expect(container.querySelector('.svn-ab--collapsed')).not.toBeNull();
  expect(
    container
      .querySelector('button[aria-label="CHANGES"]')
      ?.getAttribute('title'),
  ).toContain('Branch - trunk');
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
});
