import { expect, it } from 'vitest';
import {
  branchCandidates,
  parseSvnListDirs,
  planRows,
} from './checkoutPlan.js';
import type { ProjectStore } from './projects.js';
import { scanWorkingCopies } from './scanWorkingCopies.js';

// Modeled on a `svn list https://svn.example.test/proj/`.
const SVN_LIST = `1801/
1807/
1906/
2003/
2012/
2109/
2203/
2209/
2303/
2312/
2406/
2412/
2506/
2603/
2609/
search8/
trunk/
`;

const REPO = 'https://svn.example.test/proj/';
const disk: Record<string, string> = {
  'C:/Work/proj_trunk': 'https://svn.example.test/proj/trunk',
  'C:/Work/proj_2506': 'https://svn.example.test/proj/2506',
  'C:/Work/proj_2603': 'https://svn.example.test/proj/2603',
  'C:/Work/proj_2609': 'https://svn.example.test/proj/2609',
  'C:/Work/Feature4 Source Files': 'https://svn.example.test/branches/feat4',
  'C:/Work/LIB': 'https://svn.example.test/x/LIB',
};

it('offers every branch and adopts the four existing working copies', async () => {
  const rootDirs = parseSvnListDirs(SVN_LIST);
  const candidates = branchCandidates(REPO, rootDirs, []);
  const found = await scanWorkingCopies(
    'C:/Work',
    async (d) => (d === 'C:/Work' ? Object.keys(disk) : []),
    async (p) => ({ isWorkingCopy: p in disk, url: disk[p] }),
    REPO,
  );
  const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };
  const rows = planRows(candidates, empty, found, 'C:\\Work');

  // 17 branches, none duplicated by the four copies found on disk.
  expect(rows).toHaveLength(17);
  const attached = rows.filter((r) => r.localPath);
  expect(attached.map((r) => `${r.name} -> ${r.localPath}`)).toEqual([
    'trunk -> C:/Work/proj_trunk',
    '2506 -> C:/Work/proj_2506',
    '2603 -> C:/Work/proj_2603',
    '2609 -> C:/Work/proj_2609',
  ]);
  // Foreign repos are not pulled in.
  expect(rows.some((r) => r.localPath?.includes('Feature4'))).toBe(false);
  // A branch without a copy gets a target under the chosen folder.
  expect(rows.find((r) => r.name === 'search8')?.target).toBe(
    'C:\\Work\\search8',
  );
});
