import type { SvnChange } from '@nonu/svn';

/** Single rule for the change list and every count: externals are never pending changes, ignored only when shown. */
export const isListed = (c: SvnChange, showIgnored: boolean) =>
  c.status !== 'external' && (showIgnored || c.status !== 'ignored');

export const changeCount = (changes: SvnChange[]): number =>
  changes.filter((c) => isListed(c, false)).length;

export const conflictCount = (changes: SvnChange[]): number =>
  changes.filter((c) => c.status === 'conflicted').length;
