import type { SvnChange } from '@nonu/svn';
import { expect, it } from 'vitest';

import { folderGroupChange } from './changeMenu.js';

it('uses an existing folder status for a matching grouping path', () => {
  const folder: SvnChange = {
    path: 'new\\folder',
    status: 'unversioned',
    code: '?',
    committable: false,
  };

  expect(folderGroupChange('NEW/folder/', [folder])).toEqual({
    ...folder,
    code: 'D',
  });
});

it('treats a grouping path without its own status as a versioned folder', () => {
  expect(folderGroupChange('src', [])).toEqual({
    path: 'src',
    status: 'modified',
    code: 'D',
    committable: true,
  });
});
