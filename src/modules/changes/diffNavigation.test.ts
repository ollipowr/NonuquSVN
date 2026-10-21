import { describe, expect, it } from 'vitest';
import { nextChangeIndex } from './diffNavigation.js';

describe('diff change navigation', () => {
  it('visits every block in both directions, including changes that cannot be centered', () => {
    let current: number | null = null;
    const visited = Array.from(
      { length: 5 },
      () => (current = nextChangeIndex(current, 3, 'next')),
    );
    expect(visited).toEqual([0, 1, 2, 0, 1]);
    expect(nextChangeIndex(current, 3, 'prev')).toBe(0);
    expect(nextChangeIndex(0, 3, 'prev')).toBe(2);
  });
  it('handles empty, single and replaced diffs', () => {
    expect(nextChangeIndex(null, 0, 'next')).toBeNull();
    expect(nextChangeIndex(null, 3, 'prev')).toBe(2);
    expect(nextChangeIndex(0, 1, 'next')).toBe(0);
    expect(nextChangeIndex(5, 2, 'next')).toBe(0);
  });
});
