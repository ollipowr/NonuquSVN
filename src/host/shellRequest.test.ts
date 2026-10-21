import { describe, expect, it } from 'vitest';
import { parseShellRequest } from './shellRequest';

describe('Explorer launch requests', () => {
  it.each([
    ['--log', 'logs'],
    ['--changes', 'changes'],
    ['--branches', 'changes'],
    ['--repo', 'repo'],
  ])('routes %s to %s without losing the selected path', (flag, view) => {
    const path = 'C:\\Working copies\\Überblick';
    expect(parseShellRequest(['--', flag, path])).toEqual({ path, view });
    expect(parseShellRequest([path, flag])).toEqual({ path, view });
  });

  it('keeps a plain open separate from an action', () => {
    expect(parseShellRequest(['C:\\'])).toEqual({
      path: 'C:\\',
      view: undefined,
    });
    expect(parseShellRequest([])).toEqual({ path: '', view: undefined });
    expect(parseShellRequest(['--unknown', 'C:\\folder'])).toEqual({
      path: 'C:\\folder',
      view: undefined,
    });
  });
});
