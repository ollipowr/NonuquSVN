import type { SvnChange } from '@nonu/svn';

/** Changes a user would see in the list: ignored and external entries are bookkeeping. */
const shown = (c: SvnChange) =>
  c.status !== 'ignored' && c.status !== 'external';

export const changeCount = (changes: SvnChange[]): number =>
  changes.filter(shown).length;

export const conflictCount = (changes: SvnChange[]): number =>
  changes.filter((c) => c.status === 'conflicted').length;
