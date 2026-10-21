import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Select } from './Select.js';

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
const key = (key: string) =>
  act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ),
  );
const options = [
  { value: 'a', label: 'A', description: 'C:/one' },
  { value: 'b', label: 'B', disabled: true },
  { value: 'c', label: 'C', description: 'C:/two' },
];
it('opens with the keyboard, skips disabled choices, and restores trigger focus after selection', () => {
  const onChange = vi.fn();
  act(() =>
    root.render(
      <Select
        value="a"
        options={options}
        onChange={onChange}
        ariaLabel="Branch"
      />,
    ),
  );
  const trigger = element.querySelector<HTMLButtonElement>(
    '.svn-select-trigger',
  )!;
  act(() => trigger.focus());
  key('ArrowDown');
  expect(document.activeElement?.getAttribute('role')).toBe('listbox');
  key('ArrowDown');
  key('Enter');
  expect(onChange).toHaveBeenCalledWith('c');
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('supports Home, End and Escape without changing the selection', () => {
  const onChange = vi.fn();
  act(() =>
    root.render(<Select value="a" options={options} onChange={onChange} />),
  );
  act(() => element.querySelector<HTMLButtonElement>('button')!.click());
  key('End');
  expect(
    document.activeElement?.getAttribute('aria-activedescendant'),
  ).toContain('-2');
  key('Home');
  expect(
    document.activeElement?.getAttribute('aria-activedescendant'),
  ).toContain('-0');
  key('Escape');
  expect(element.querySelector('[role="listbox"]')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
it('renders path descriptions and an honest empty state and respects disabled triggers', () => {
  act(() =>
    root.render(<Select value="a" options={options} onChange={() => {}} />),
  );
  act(() => element.querySelector<HTMLButtonElement>('button')!.click());
  expect(element.textContent).toContain('C:/one');
  act(() =>
    root.render(
      <Select
        value=""
        options={[]}
        emptyLabel="No copies"
        onChange={() => {}}
      />,
    ),
  );
  expect(element.querySelector('[role="status"]')?.textContent).toBe(
    'No copies',
  );
  act(() =>
    root.render(<Select disabled value="" options={[]} onChange={() => {}} />),
  );
  expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(
    true,
  );
  expect(element.querySelector('[role="listbox"]')).toBeNull();
});
it('closes when focus leaves the control', () => {
  act(() =>
    root.render(<Select value="a" options={options} onChange={() => {}} />),
  );
  act(() => element.querySelector<HTMLButtonElement>('button')!.click());
  const other = document.createElement('button');
  document.body.append(other);
  act(() => other.focus());
  expect(element.querySelector('[role="listbox"]')).toBeNull();
  other.remove();
});
