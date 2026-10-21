import { expect, it } from 'vitest';
import { buildNavViews } from './navViews.js';

const expected = ['changes', 'logs', 'repo'];
it('keeps exactly the same order on every view and without a working copy', () => {
  for (const activeView of ['merge', ...expected]) {
    const views = buildNavViews({
      activeView: activeView as any,
      hasWorkspace: true,
      changesCount: 3,
    });
    expect(views.map((v) => v.id)).toEqual(expected);
    expect(views[0].badge).toBe(3);
  }
});
it('disables unavailable contexts without removing tabs', () => {
  const views = buildNavViews({
    hasWorkspace: false,
    changesCount: 0,
  });
  expect(views.map((v) => v.id)).toEqual(expected);
  expect(views.every((v) => v.disabled)).toBe(true);
});
it('disables workspace views without a project or working copy', () => {
  const views = buildNavViews({
    hasWorkspace: false,
    changesCount: 0,
  });
  expect(views.every((v) => v.disabled)).toBe(true);
});
