import type { SvnChange } from '@nonu/svn';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { useChangesModel } from './useChangesModel.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('excludes filtered selections from bulk operations while retaining collapsed-folder selections', () => {
  const changes = ['a/one.ts', 'b/two.ts', 'c/hidden.txt'].map(
    (path) => ({ path, status: 'modified', committable: true }) as SvnChange,
  );
  let model!: ReturnType<typeof useChangesModel>;
  function Harness() {
    model = useChangesModel({
      changes,
      filterStatus: 'all',
      showIgnored: false,
      sortBy: 'name',
      mtimes: new Map(),
      query: '.ts',
      groupByFolder: true,
      collapsedFolders: new Set(['b']),
      selected: new Set(changes.map((change) => change.path)),
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => root.render(<Harness />));
    expect(model.visiblePaths).toEqual(['a/one.ts']);
    expect(model.visibleSelectedPaths.map((change) => change.path)).toEqual([
      'a/one.ts',
      'b/two.ts',
    ]);
    expect(model.hiddenSelectedCount).toBe(1);
  } finally {
    act(() => root.unmount());
  }
});
