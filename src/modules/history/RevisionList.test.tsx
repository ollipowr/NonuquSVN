import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RevisionList } from './RevisionList.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom does not implement these browser layout APIs.
Object.assign(globalThis, { CSS: { escape: (value: string) => value } });
HTMLElement.prototype.scrollIntoView = vi.fn();

it('supports keyboard navigation and range selection', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  try {
    await act(async () =>
      root.render(
        <RevisionList
          entries={['3', '2', '1'].map((revision) => ({
            revision,
            author: '',
            date: '',
            message: '',
          }))}
          activeRevision="3"
          onSelect={onSelect}
          filter=""
          onFilterChange={vi.fn()}
        />,
      ),
    );
    const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
    await act(async () =>
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    );
    expect(onSelect).toHaveBeenLastCalledWith('2');
    await act(async () =>
      list.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(onSelect).toHaveBeenLastCalledWith('1');
    expect(
      Array.from(
        container.querySelectorAll('[role="option"][aria-selected="true"]'),
      ).map((row) => row.getAttribute('data-list-key')),
    ).toEqual(['2', '1']);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
