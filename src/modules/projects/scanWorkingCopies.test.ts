import { expect, it } from 'vitest';
import { scanWorkingCopies } from './scanWorkingCopies';

const wcs: Record<string, string> = {
  '/w/trunk': 'svn://h/project/trunk',
  '/w/b1': 'svn://h/project/branches/b1',
  '/w/other': 'svn://h/other/trunk',
};
const list = async () => ['/w/trunk', '/w/b1', '/w/other', '/w/plain'];
const detect = async (p: string) => ({ isWorkingCopy: p in wcs, url: wcs[p] });

it('finds working copies and skips plain folders', async () => {
  const found = await scanWorkingCopies('/w', list, detect);
  expect(found.map((f) => f.path)).toEqual(['/w/trunk', '/w/b1', '/w/other']);
});

it('filters to the given repository', async () => {
  const found = await scanWorkingCopies('/w', list, detect, 'svn://h/project');
  expect(found.map((f) => f.path)).toEqual(['/w/trunk', '/w/b1']);
});

const nested: Record<string, string> = {
  '/p/kunde/app/trunk': 'svn://h/app/trunk',
  '/p/kunde/app/rel': 'svn://h/app/branches/rel',
};
const tree: Record<string, string[]> = {
  '/p': ['/p/kunde'],
  '/p/kunde': ['/p/kunde/app'],
  '/p/kunde/app': ['/p/kunde/app/trunk', '/p/kunde/app/rel'],
  '/p/kunde/app/trunk': ['/p/kunde/app/trunk/src'],
};
const listTree = async (d: string) => tree[d] ?? [];
const detectNested = async (p: string) => ({
  isWorkingCopy: p in nested,
  url: nested[p],
});

it('finds working copies three levels down', async () => {
  const found = await scanWorkingCopies('/p', listTree, detectNested);
  expect(found.map((f) => f.path)).toEqual([
    '/p/kunde/app/trunk',
    '/p/kunde/app/rel',
  ]);
});

it('does not descend into a working copy', async () => {
  const visited: string[] = [];
  await scanWorkingCopies(
    '/p',
    async (d) => {
      visited.push(d);
      return tree[d] ?? [];
    },
    detectNested,
  );
  expect(visited).not.toContain('/p/kunde/app/trunk');
});

// Real shape: branches sit flat under the repo root, so branchGroupKey would
// produce a different key per branch and filter all of them out.
const flat: Record<string, string> = {
  '/s/proj_trunk': 'https://svn.example.test/proj/trunk',
  '/s/proj_2506': 'https://svn.example.test/proj/2506',
  '/s/proj_2609': 'https://svn.example.test/proj/2609',
  '/s/other': 'https://svn.example.test/branches/feat4',
};
const listFlat = async (d: string) =>
  d === '/s' ? Object.keys(flat).concat('/s/plain') : [];
const detectFlat = async (p: string) => ({
  isWorkingCopy: p in flat,
  url: flat[p],
});

it('keeps flat-layout branches of the same repository', async () => {
  const found = await scanWorkingCopies(
    '/s',
    listFlat,
    detectFlat,
    'https://svn.example.test/proj/',
  );
  expect(found.map((f) => f.path)).toEqual([
    '/s/proj_trunk',
    '/s/proj_2506',
    '/s/proj_2609',
  ]);
});
