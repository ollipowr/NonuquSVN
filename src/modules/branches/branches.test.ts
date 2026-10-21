import { describe, expect, it } from 'vitest';
import {
  type BranchRegistry,
  isSwitchModel,
  loadRegistry,
  normalizePath,
} from './branches.js';

function fakeStorage(value: unknown) {
  return {
    get: <T>() => value as T | undefined,
    set: async () => {},
    getGlobal: <T>() => undefined as T | undefined,
    setGlobal: async () => {},
  };
}

describe('loadRegistry', () => {
  it('returns an empty registry when nothing is stored', () => {
    expect(loadRegistry(fakeStorage(undefined))).toEqual({
      entries: [],
      roots: [],
    });
  });

  it('drops entries without a url', () => {
    const stored = {
      entries: [
        { id: 'a', name: 'A', url: '' },
        { id: 'b', name: 'B', url: 'u' },
      ],
      roots: [],
    };
    expect(loadRegistry(fakeStorage(stored)).entries.map((e) => e.id)).toEqual([
      'b',
    ]);
  });

  it('tolerates a corrupt payload', () => {
    expect(loadRegistry(fakeStorage({ entries: 'nope' }))).toEqual({
      entries: [],
      roots: [],
    });
  });
});

describe('isSwitchModel', () => {
  const reg: BranchRegistry = {
    entries: [
      {
        id: '1',
        name: 'trunk',
        url: 'u/trunk',
        localPath: 'C:\\wc',
        kind: 'trunk',
      },
      {
        id: '2',
        name: 'feat',
        url: 'u/feat',
        localPath: 'C:/wc/',
        kind: 'branch',
      },
      {
        id: '3',
        name: 'other',
        url: 'u/other',
        localPath: 'C:\\other',
        kind: 'branch',
      },
      { id: '4', name: 'remote', url: 'u/remote', kind: 'branch' },
    ],
    roots: [],
  };

  it('is true when two entries share one working copy, ignoring slashes and case', () => {
    expect(isSwitchModel(reg, reg.entries[0])).toBe(true);
    expect(isSwitchModel(reg, reg.entries[1])).toBe(true);
  });

  it('is false for a unique path and for remote-only entries', () => {
    expect(isSwitchModel(reg, reg.entries[2])).toBe(false);
    expect(isSwitchModel(reg, reg.entries[3])).toBe(false);
  });
});

describe('normalizePath', () => {
  it('strips trailing separators and normalizes slashes', () => {
    expect(normalizePath('C:\\wc\\')).toBe('c:/wc');
  });
});

import {
  formatMergeCommitMessage,
  formatRevisionRanges,
  guessKind,
  parseEligibleRevs,
  parseLogXml,
  parseLsEntries,
  parseMergeResult,
  parseSvnVersion,
  supportsMergeTracking,
} from './branches.js';

describe('merge commit message formatting', () => {
  it('compacts consecutive revisions into ranges', () => {
    expect(formatRevisionRanges([166329, 166205, 166204, 166291, 166290])).toBe(
      '166204-166205, 166290-166291, 166329',
    );
  });

  it('writes log messages in revision order with separators', () => {
    expect(
      formatMergeCommitMessage([166205, 166204, 166329], 'proj/trunk', [
        { rev: 166329, author: 'a', date: '', message: 'Third' },
        { rev: 166204, author: 'a', date: '', message: 'First' },
        { rev: 166205, author: 'a', date: '', message: 'Second' },
      ]),
    ).toBe(
      'Merged revision(s) 166204-166205, 166329 from proj/trunk:\n' +
        'First\n........\nSecond\n........\nThird\n........',
    );
  });
});

describe('parseSvnVersion / supportsMergeTracking', () => {
  it('reads the quiet form', () => {
    expect(parseSvnVersion('1.14.3\n')?.version).toBe('1.14.3');
  });

  it('reads the long form', () => {
    const v = parseSvnVersion(
      'svn, version 1.14.3 (r1914484)\n   compiled Apr 16 2024',
    );
    expect(v).toMatchObject({ major: 1, minor: 14 });
  });

  it('gates on 1.8', () => {
    expect(supportsMergeTracking(parseSvnVersion('1.14.3'))).toBe(true);
    expect(supportsMergeTracking(parseSvnVersion('1.8.0'))).toBe(true);
    expect(supportsMergeTracking(parseSvnVersion('1.7.22'))).toBe(false);
    expect(supportsMergeTracking(null)).toBe(false);
  });
});

describe('parseEligibleRevs', () => {
  it('reads one revision per line', () => {
    expect(parseEligibleRevs('r5\n')).toEqual([5]);
  });

  it('returns nothing when there is nothing eligible', () => {
    expect(parseEligibleRevs('\n')).toEqual([]);
  });

  it('expands ranges and sorts', () => {
    expect(parseEligibleRevs('r7\nr3-r5\n')).toEqual([3, 4, 5, 7]);
  });
});

describe('parseLogXml', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="5">
<author>o.juenger</author>
<date>2026-10-06T21:58:44.400260Z</date>
<msg>third commit trunk</msg>
</logentry>
</log>`;

  it('reads revision, author, ISO date and message', () => {
    expect(parseLogXml(xml)).toEqual([
      {
        rev: 5,
        author: 'o.juenger',
        date: '2026-10-06T21:58:44.400260Z',
        message: 'third commit trunk',
      },
    ]);
  });

  it('survives an empty log', () => {
    expect(parseLogXml('<?xml version="1.0"?><log></log>')).toEqual([]);
  });
});

describe('parseMergeResult', () => {
  it('reads a clean dry-run', () => {
    const out = `--- Merging r5 into '.':\nU    a.txt\n`;
    expect(parseMergeResult(out)).toEqual({
      files: [{ action: 'U', path: 'a.txt' }],
      conflicts: 0,
      mergedRevs: [5],
    });
  });

  it('detects conflicts even though svn exits 0', () => {
    const out = `--- Merging r5 into '.':\nC    a.txt\nSummary of conflicts:\n  Text conflicts: 1\n`;
    const r = parseMergeResult(out);
    expect(r.conflicts).toBe(1);
    expect(r.files).toEqual([{ action: 'C', path: 'a.txt' }]);
  });

  it('ignores mergeinfo bookkeeping lines', () => {
    const out = [
      `--- Merging r5 into '.':`,
      `C    a.txt`,
      `--- Recording mergeinfo for merge of r5 into '.':`,
      ` U   .`,
      `Summary of conflicts:`,
      `  Text conflicts: 1`,
    ].join('\n');
    const r = parseMergeResult(out);
    expect(r.files).toEqual([{ action: 'C', path: 'a.txt' }]);
    expect(r.conflicts).toBe(1);
  });
});

describe('parseLsEntries / guessKind', () => {
  it('keeps only directories', () => {
    expect(parseLsEntries('branches/\ntrunk/\nREADME.md\n')).toEqual([
      'branches',
      'trunk',
    ]);
  });

  it('suggests a kind without assuming a layout', () => {
    expect(guessKind('trunk')).toBe('trunk');
    expect(guessKind('main')).toBe('trunk');
    expect(guessKind('branches/feat')).toBe('branch');
    expect(guessKind('tags/v1')).toBe('tag');
    expect(guessKind('kundenprojekt-2024')).toBe('other');
  });
});
