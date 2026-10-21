import { describe, expect, it } from 'vitest';
import {
  branchCandidates,
  existingCopy,
  normalizeUrl,
  parseSvnListDirs,
  planRows,
  targetFolderName,
} from './checkoutPlan.js';
import type { ProjectStore } from './projects.js';

describe('parseSvnListDirs', () => {
  it('keeps only directory entries', () => {
    const out = 'branches/\r\ntrunk/\ntags/\nREADME.txt\n';
    expect(parseSvnListDirs(out)).toEqual(['branches', 'trunk', 'tags']);
  });
});

describe('branchCandidates', () => {
  it('lists trunk and every branch in the standard layout', () => {
    const list = branchCandidates(
      'https://host/svn/proj/',
      ['trunk', 'branches', 'tags'],
      ['1.0', 'feature-x'],
    );
    expect(list).toEqual([
      { name: 'trunk', url: 'https://host/svn/proj/trunk', kind: 'trunk' },
      {
        name: '1.0',
        url: 'https://host/svn/proj/branches/1.0',
        kind: 'branch',
      },
      {
        name: 'feature-x',
        url: 'https://host/svn/proj/branches/feature-x',
        kind: 'branch',
      },
    ]);
  });

  it('treats a URL without layout folders as one branch', () => {
    expect(branchCandidates('https://host/svn/proj/spike', [], [])).toEqual([
      { name: 'spike', url: 'https://host/svn/proj/spike', kind: 'other' },
    ]);
  });
});

describe('existingCopy', () => {
  const store: ProjectStore = {
    version: 1,
    projects: [],
    workspaces: [
      {
        id: 'w1',
        projectId: 'p1',
        name: 'trunk',
        svnUrl: 'https://host/svn/proj/trunk/',
        localPath: 'C:/work/trunk',
        kind: 'trunk',
      },
    ],
  };

  it('matches the URL ignoring trailing slash and case', () => {
    expect(existingCopy(store, 'HTTPS://host/svn/proj/trunk')?.id).toBe('w1');
    expect(normalizeUrl('https://x/Trunk/')).toBe('https://x/trunk');
  });

  it('returns undefined for an unknown branch', () => {
    expect(existingCopy(store, 'https://host/svn/proj/branches/a')).toBe(
      undefined,
    );
  });
});

describe('targetFolderName', () => {
  it('flattens slashes so a branch never becomes a subfolder', () => {
    expect(targetFolderName('release/2.1')).toBe('release-2.1');
    expect(targetFolderName('a\\b')).toBe('a-b');
  });

  it('strips characters a folder cannot hold', () => {
    expect(targetFolderName('fix: a?b')).toBe('fix- a-b');
    expect(targetFolderName('///')).toBe('branch');
  });
});

describe('planRows', () => {
  const candidates = [
    {
      name: 'trunk',
      url: 'https://host/svn/proj/trunk',
      kind: 'trunk' as const,
    },
    {
      name: 'release/2.1',
      url: 'https://host/svn/proj/branches/release/2.1',
      kind: 'branch' as const,
    },
  ];
  const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };

  it('marks a scanned copy as on disk and plans a target for the rest', () => {
    const rows = planRows(
      candidates,
      empty,
      [{ path: 'D:/w/trunk', url: 'HTTPS://host/svn/proj/trunk/' }],
      'D:/w/',
    );
    expect(rows[0].localPath).toBe('D:/w/trunk');
    expect(rows[1].localPath).toBeUndefined();
    expect(rows[1].target).toBe('D:/w/release-2.1');
  });

  it('reuses a copy already known to the store and names its project', () => {
    const store: ProjectStore = {
      version: 1,
      projects: [],
      workspaces: [
        {
          id: 'w1',
          projectId: 'p1',
          name: 'trunk',
          svnUrl: 'https://host/svn/proj/trunk',
          localPath: 'C:/old/trunk',
          kind: 'trunk',
        },
      ],
    };
    const rows = planRows(candidates, store, [], 'D:/w');
    expect(rows[0].localPath).toBe('C:/old/trunk');
    expect(rows[0].ownedBy).toBe('p1');
  });

  it('keeps targets unique when two branches share a leaf name', () => {
    const rows = planRows(
      [
        { name: 'a/x', url: 'https://h/svn/p/branches/a/x', kind: 'branch' },
        { name: 'b\\x', url: 'https://h/svn/p/branches/b/x', kind: 'branch' },
      ],
      empty,
      [],
      'D:/w',
    );
    expect(rows.map((r) => r.target)).toEqual(['D:/w/a-x', 'D:/w/b-x']);
  });
});

describe('flat branch layout', () => {
  // Shape of a real repo: versions sit next to trunk, there is no branches/.
  const rootDirs = ['1801', '2506', '2609', 'search8', 'trunk'];

  it('treats folders next to trunk as branches when branches/ is absent', () => {
    const list = branchCandidates(
      'https://svn.example.test/proj/',
      rootDirs,
      [],
    );
    expect(list).toEqual([
      {
        name: 'trunk',
        url: 'https://svn.example.test/proj/trunk',
        kind: 'trunk',
      },
      {
        name: '1801',
        url: 'https://svn.example.test/proj/1801',
        kind: 'branch',
      },
      {
        name: '2506',
        url: 'https://svn.example.test/proj/2506',
        kind: 'branch',
      },
      {
        name: '2609',
        url: 'https://svn.example.test/proj/2609',
        kind: 'branch',
      },
      {
        name: 'search8',
        url: 'https://svn.example.test/proj/search8',
        kind: 'branch',
      },
    ]);
  });

  it('never offers trunk, branches or tags as a branch of their own', () => {
    const list = branchCandidates(
      'https://host/svn/p',
      ['trunk', 'branches', 'tags'],
      ['rel-1'],
    );
    expect(list.map((c) => c.name)).toEqual(['trunk', 'rel-1']);
  });
});

describe('planRows keeps working copies that svn list did not offer', () => {
  const empty: ProjectStore = { version: 1, projects: [], workspaces: [] };

  it('adds a row for a scanned copy with no matching candidate', () => {
    const rows = planRows(
      [
        {
          name: 'trunk',
          url: 'https://svn.example.test/proj/trunk',
          kind: 'trunk',
        },
      ],
      empty,
      [
        {
          path: 'C:/Work/proj_trunk',
          url: 'https://svn.example.test/proj/trunk',
        },
        {
          path: 'C:/Work/proj_2506',
          url: 'https://svn.example.test/proj/2506',
        },
      ],
      'C:/Work',
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      name: '2506',
      url: 'https://svn.example.test/proj/2506',
      localPath: 'C:/Work/proj_2506',
    });
  });

  it('does not duplicate a copy that a candidate already covers', () => {
    const rows = planRows(
      [{ name: 'trunk', url: 'https://h/p/trunk', kind: 'trunk' }],
      empty,
      [{ path: 'D:/w/trunk', url: 'HTTPS://h/p/trunk/' }],
      'D:/w',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].localPath).toBe('D:/w/trunk');
  });
});
