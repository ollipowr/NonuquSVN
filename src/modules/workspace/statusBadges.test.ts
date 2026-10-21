import type { SvnChange } from '@nonu/svn';
import { expect, it } from 'vitest';

import { changeCount, conflictCount } from './statusBadges.js';

const c = (status: SvnChange['status']): SvnChange => ({
  path: status,
  status,
  code: status[0].toUpperCase(),
  committable: true,
});

it('counts real changes and skips ignored and external entries', () => {
  const changes = [
    c('modified'),
    c('unversioned'),
    c('ignored'),
    c('external'),
  ];
  expect(changeCount(changes)).toBe(2);
});

it('counts conflicts', () => {
  expect(conflictCount([c('conflicted'), c('modified'), c('conflicted')])).toBe(
    2,
  );
  expect(conflictCount([])).toBe(0);
});
