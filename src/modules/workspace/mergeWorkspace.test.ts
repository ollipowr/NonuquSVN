import type { BranchRegistry } from '@nonu/modules/branches/branches';
import { expect, it } from 'vitest';
import { mergeRegistryForWorkspace } from './mergeWorkspace.js';

it('makes an unregistered working copy available as a merge target without another branch', () => {
  const registry: BranchRegistry = { entries: [], roots: [] };
  const result = mergeRegistryForWorkspace(
    registry,
    'C:/work/trunk',
    'svn://example/project/trunk',
  );
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0]).toMatchObject({
    name: 'trunk',
    localPath: 'C:/work/trunk',
    url: 'svn://example/project/trunk',
  });
  expect(registry.entries).toHaveLength(0);
});
it('preserves an existing target across path casing and separators', () => {
  const registry: BranchRegistry = {
    entries: [
      {
        id: 'target',
        name: 'trunk',
        url: 'svn://example/trunk',
        localPath: 'C:/Work/Trunk',
        kind: 'trunk',
      },
    ],
    roots: [],
  };
  expect(
    mergeRegistryForWorkspace(registry, 'c:/work/trunk', 'svn://example/trunk'),
  ).toBe(registry);
});
it('does not invent a target without repository information', () => {
  const registry: BranchRegistry = { entries: [], roots: [] };
  expect(mergeRegistryForWorkspace(registry, 'C:/work')).toBe(registry);
});
