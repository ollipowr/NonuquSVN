import { expect, it } from 'vitest';
import {
  absoluteLocalLogPath,
  localLogPath,
  logFileTarget,
} from './logPaths.js';

const repo = {
  isWorkingCopy: true,
  url: 'https://example.test/svn/project/trunk',
  repositoryRoot: 'https://example.test/svn/project',
};

it('maps log paths relative to the checked-out branch or subdirectory', () => {
  expect(localLogPath('/trunk/src/file.ts', repo)).toBe('src/file.ts');
  expect(
    localLogPath('/trunk/src/file.ts', { ...repo, url: repo.url + '/src' }),
  ).toBe('file.ts');
  expect(
    localLogPath('/trunk/src/file.ts', { ...repo, url: repo.repositoryRoot }),
  ).toBe('trunk/src/file.ts');
  expect(
    localLogPath('/branches/my branch/file.ts', {
      ...repo,
      url: repo.repositoryRoot + '/branches/my%20branch',
    }),
  ).toBe('file.ts');
});

it('uses the checkout root instead of the open workspace directory for absolute paths', () => {
  const nestedWorkspace = {
    ...repo,
    url: repo.url + '/src/deep',
    root: 'C:\\work\\checkout',
    workingCopyUrl: repo.url,
  };
  expect(absoluteLocalLogPath('/trunk/src/file.ts', nestedWorkspace)).toBe(
    'C:\\work\\checkout\\src\\file.ts',
  );
  expect(
    absoluteLocalLogPath('/branches/other/file.ts', nestedWorkspace),
  ).toBeNull();
});

it('derives the checkout URL for cached repo data that predates workingCopyUrl', () => {
  const cached = {
    ...repo,
    url: repo.url + '/src/deep',
    root: 'C:\\work\\checkout',
  };
  expect(
    absoluteLocalLogPath(
      '/trunk/src/file.ts',
      cached,
      'C:\\work\\checkout\\src\\deep',
    ),
  ).toBe('C:\\work\\checkout\\src\\file.ts');
});

it('does not map other branches or paths outside the working copy', () => {
  expect(localLogPath('/branches/other/file.ts', repo)).toBeNull();
  expect(localLogPath('/trunk-other/file.ts', repo)).toBeNull();
  expect(localLogPath('/trunk/../file.ts', repo)).toBeNull();
  expect(localLogPath('/trunk/file.ts', null)).toBeNull();
});

it('pins historical targets including deletions and special characters', () => {
  expect(logFileTarget('/trunk/file.ts', '42', 'M')).toEqual({
    target: '^/trunk/file.ts@42',
    revision: '42',
  });
  expect(logFileTarget('/trunk/file.ts', '42', 'D')).toEqual({
    target: '^/trunk/file.ts@41',
    revision: '41',
  });
  expect(logFileTarget('/trunk/a @b#%.ts', '42', 'A').target).toBe(
    '^/trunk/a%20%40b%23%25.ts@42',
  );
  expect(
    logFileTarget(
      '/trunk/file.ts',
      '42',
      'M',
      'https://example.test/svn/project',
    ).target,
  ).toBe('https://example.test/svn/project/trunk/file.ts@42');
});
