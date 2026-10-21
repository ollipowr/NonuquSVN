import type { SvnChange } from '@nonu/svn';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { ChangesList } from './ChangesList.js';

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const change = (path: string): SvnChange => ({
  path,
  status: 'modified',
  code: 'M',
  committable: true,
});

it('opens the folder context menu from a grouping header', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const srcChanges = [change('src/one.ts'), change('src/two.ts')];
  const onFolderContextMenu = vi.fn();
  try {
    act(() =>
      root.render(
        <ChangesList
          groups={
            new Map([
              ['src', srcChanges],
              ['tests', [change('tests/one.test.ts')]],
            ])
          }
          groupByFolder
          allVisibleChanges={[...srcChanges, change('tests/one.test.ts')]}
          collapsedFolders={new Set()}
          directoryPaths={new Set()}
          mtimes={new Map()}
          selected={new Set()}
          highlighted={new Set()}
          revalidating={false}
          hasLoaded
          listRef={{ current: null }}
          onKeyDown={vi.fn()}
          onToggleFolder={vi.fn()}
          onRowClick={vi.fn()}
          onRowDoubleClick={vi.fn()}
          onContextMenu={vi.fn()}
          onFolderContextMenu={onFolderContextMenu}
          onCheckboxClick={vi.fn()}
          onOpen={vi.fn()}
          onRevert={vi.fn()}
          onPreview={vi.fn()}
          onResolve={vi.fn()}
        />,
      ),
    );

    const header = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.svn-folder-row'),
    ).find((element) => element.textContent?.includes('src'));
    expect(header).toBeDefined();
    act(() =>
      header!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
    );
    expect(onFolderContextMenu).toHaveBeenCalledWith(
      expect.anything(),
      'src',
      srcChanges,
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
