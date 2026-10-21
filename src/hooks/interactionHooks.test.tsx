import { useListSelection } from '@nonu/components';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { useConfirmation } from './useConfirmation.js';
import { useResize } from './useResize.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function mount(Component: () => React.JSX.Element) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Component />));
  const unmount = () => act(() => root.unmount());
  cleanups.push(unmount);
  return { container, unmount };
}

it('keeps extended row selection separate from checked files and delegates virtual scrolling', () => {
  const checked = vi.fn();
  const scroll = vi.fn();
  const enter = vi.fn();
  const keys = ['first', 'second', 'third'];
  const { container } = mount(() => {
    const listRef = useRef<HTMLDivElement>(null);
    const selection = useListSelection({
      keys,
      listRef,
      rangeMode: 'extend',
      scrollToKey: scroll,
      onSpace: checked,
      onEnter: enter,
    });
    return (
      <div ref={listRef} onKeyDown={selection.onKeyDown}>
        {keys.map((key) => (
          <button
            key={key}
            aria-pressed={selection.highlighted.has(key)}
            onClick={(event) => selection.select(event, key)}
          >
            {key}
          </button>
        ))}
      </div>
    );
  });
  const list = container.firstElementChild!;
  const key = (value: string, shiftKey = false) =>
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true }),
      );
    });
  act(() => {
    container.querySelector('button')!.click();
  });
  key('ArrowDown', true);
  key('ArrowDown', true);
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(3);
  expect(scroll).toHaveBeenLastCalledWith('third', 2);
  expect(checked).not.toHaveBeenCalled();
  key(' ');
  expect(checked).toHaveBeenLastCalledWith(new Set(keys));
  key('Enter');
  expect(enter).toHaveBeenLastCalledWith(new Set(keys), 'third');
  // At the list boundary the Changes view retains its original single-row behavior.
  key('ArrowDown', true);
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
});

it('clamps resizing, persists on blur, and removes listeners on unmount', () => {
  const change = vi.fn();
  const end = vi.fn();
  const { container, unmount } = mount(() => {
    const resize = useResize({
      start: () => ({ value: (event) => event.clientX, min: 20, max: 80 }),
      onChange: change,
      onEnd: end,
    });
    return <div onMouseDown={resize} />;
  });
  act(() => {
    container.firstElementChild!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
  });
  expect(change).toHaveBeenLastCalledWith(80);
  act(() => {
    window.dispatchEvent(new Event('blur'));
  });
  expect(end).toHaveBeenCalledExactlyOnceWith(80);
  act(() => {
    container.firstElementChild!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true }),
    );
  });
  unmount();
  cleanups.pop();
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10 }));
  expect(change).toHaveBeenCalledTimes(1);
});

it('cancels without executing and retains a follow-up confirmation opened by a callback', () => {
  let dialog!: ReturnType<typeof useConfirmation>;
  mount(() => {
    dialog = useConfirmation();
    return <div />;
  });
  const action = vi.fn();
  const options = { title: 'Confirm', message: '', onConfirm: action };
  act(() => dialog.show(options));
  act(() => dialog.cancel());
  expect(action).not.toHaveBeenCalled();
  expect(dialog.confirmation).toBeNull();
  act(() =>
    dialog.show({
      ...options,
      onConfirm: () => dialog.show({ ...options, title: 'Second' }),
    }),
  );
  act(() => dialog.confirmation!.onConfirm());
  expect(dialog.confirmation?.title).toBe('Second');
  act(() => dialog.confirmation!.onConfirm());
  expect(action).toHaveBeenCalledOnce();
});
