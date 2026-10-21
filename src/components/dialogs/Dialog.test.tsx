import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog, DialogOverlay } from './Dialog.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let element: HTMLDivElement;
let root: Root;
beforeEach(() => {
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
});
it('closes on backdrop clicks and Escape while leaving content clicks alone', () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      <Dialog title="Details" onClose={onClose}>
        <button>Inside</button>
      </Dialog>,
    ),
  );
  act(() =>
    element.querySelector<HTMLButtonElement>('.dialog-body button')!.click(),
  );
  expect(onClose).not.toHaveBeenCalled();
  act(() => element.querySelector<HTMLElement>('.dialog-overlay')!.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(onClose).toHaveBeenCalledTimes(2);
});
it('keeps specialized overlays non-dismissible unless they supply a close callback', () => {
  const child = vi.fn();
  act(() =>
    root.render(
      <DialogOverlay className="svn-auth-overlay">
        <button onClick={child}>Retry</button>
      </DialogOverlay>,
    ),
  );
  act(() => element.querySelector<HTMLButtonElement>('button')!.click());
  expect(child).toHaveBeenCalledOnce();
  expect(element.querySelector('.svn-auth-overlay')).not.toBeNull();
});
