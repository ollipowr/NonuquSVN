import { expect, it } from 'vitest';
import type { BranchEntry } from './branches.js';
import { defaultMergeDirection } from './mergeDirection.js';

const entry = (id: string, kind: BranchEntry['kind']): BranchEntry => ({
  id,
  name: id,
  url: `svn://x/${id}`,
  kind,
  localPath: `C:/${id}`,
});

it('keeps the existing default and accepts a complete directed preset', () => {
  const entries = [
    entry('trunk', 'trunk'),
    entry('rc', 'branch'),
    entry('prod', 'branch'),
  ];
  expect(defaultMergeDirection(entries)).toEqual({
    sourceId: 'trunk',
    targetId: 'rc',
  });
  expect(defaultMergeDirection(entries, 'prod', 'trunk')).toEqual({
    sourceId: 'prod',
    targetId: 'trunk',
  });
});

it('selects a different source when merging into the current trunk', () => {
  expect(
    defaultMergeDirection(
      [entry('trunk', 'trunk'), entry('rc', 'branch')],
      undefined,
      'trunk',
    ),
  ).toEqual({ sourceId: 'rc', targetId: 'trunk' });
});
