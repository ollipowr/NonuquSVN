import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ContextMenu } from './ContextMenu.js';

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

const buttonWithText = (text: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;

it('runs the clicked item and closes the menu', () => {
  const onClick = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: 'Commit', onClick }, { label: 'Revert' }]}
        onClose={onClose}
      />,
    ),
  );

  act(() => buttonWithText('Commit').click());

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('renders separators without a button', () => {
  act(() =>
    root.render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: 'A' }, { separator: true }, { label: 'B' }]}
        onClose={vi.fn()}
      />,
    ),
  );

  expect(
    container.querySelectorAll('.svn-context-menu-separator'),
  ).toHaveLength(1);
  expect(container.querySelectorAll('button')).toHaveLength(2);
});

it('closes on Escape', () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      <ContextMenu x={0} y={0} items={[{ label: 'A' }]} onClose={onClose} />,
    ),
  );

  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes on a mousedown outside but not inside', () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      <ContextMenu x={0} y={0} items={[{ label: 'A' }]} onClose={onClose} />,
    ),
  );

  act(() => {
    buttonWithText('A').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
  });
  expect(onClose).not.toHaveBeenCalled();

  act(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
