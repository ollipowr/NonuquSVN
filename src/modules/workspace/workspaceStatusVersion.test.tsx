import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import {
  invalidateWorkspace,
  useWorkspaceStatusVersion,
} from './workspaceStore.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('re-renders subscribers whenever any workspace status changes', () => {
  const seen: number[] = [];
  const Probe = () => {
    seen.push(useWorkspaceStatusVersion());
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  const before = seen[seen.length - 1];
  act(() => invalidateWorkspace('C:/any/path'));
  expect(seen[seen.length - 1]).toBeGreaterThan(before);
  act(() => root.unmount());
});
