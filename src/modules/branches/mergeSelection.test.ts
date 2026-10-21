import { describe, expect, it } from 'vitest';
import { areWorkingCopiesChecked, isContiguousFromOldest } from './MergeView';

describe('isContiguousFromOldest', () => {
  const eligible = [101, 102, 103, 104];

  it('accepts a contiguous run from the oldest revision', () => {
    expect(isContiguousFromOldest(eligible, [101, 102])).toBe(true);
    expect(isContiguousFromOldest(eligible, [101, 102, 103, 104])).toBe(true);
  });

  it('flags a gap', () => {
    expect(isContiguousFromOldest(eligible, [101, 103])).toBe(false);
  });

  it('flags a selection that skips the oldest revision', () => {
    expect(isContiguousFromOldest(eligible, [102, 103])).toBe(false);
  });

  it('treats an empty selection as fine (nothing to warn about)', () => {
    expect(isContiguousFromOldest(eligible, [])).toBe(true);
  });

  it('ignores input order', () => {
    expect(isContiguousFromOldest(eligible, [102, 101])).toBe(true);
  });
});

describe('areWorkingCopiesChecked', () => {
  const workingCopies = [{ id: 'source' }, { id: 'target' }];

  it('is false before any status has been fetched', () => {
    expect(areWorkingCopiesChecked(workingCopies, new Map())).toBe(false);
  });

  it('is false while a working copy has a confirmed pending update', () => {
    const statuses = new Map([
      ['source', { updateAvailable: false }],
      ['target', { updateAvailable: true }],
    ]);
    expect(areWorkingCopiesChecked(workingCopies, statuses)).toBe(false);
  });

  it('is true once every working copy is confirmed up to date', () => {
    const statuses = new Map([
      ['source', { updateAvailable: false }],
      ['target', { updateAvailable: false }],
    ]);
    expect(areWorkingCopiesChecked(workingCopies, statuses)).toBe(true);
  });

  // Regression: an unknown remote check (`undefined`) must not block the "Next" button.
  it('is true when a status came back unknown (not a pending update) rather than hanging forever', () => {
    const statuses = new Map([
      ['source', { updateAvailable: false }],
      ['target', { updateAvailable: undefined }],
    ]);
    expect(areWorkingCopiesChecked(workingCopies, statuses)).toBe(true);
  });
});
