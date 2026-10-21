import { describe, expect, it } from 'vitest';
import { buildCheckoutArgs } from './checkoutArgs';

describe('buildCheckoutArgs', () => {
  it('passes a password with double quotes and shell metacharacters verbatim', () => {
    const password = 'p"ss &x#ä 1';
    const args = buildCheckoutArgs({
      url: 'svn://127.0.0.1:3690/project',
      target: 'C:\\work\\project',
      username: 'carol',
      password,
    });
    expect(args).toContain(password);
    expect(args[args.indexOf('--password') + 1]).toBe(password);
    expect(args[args.indexOf('--username') + 1]).toBe('carol');
  });

  it('omits credential flags when no username is given', () => {
    const args = buildCheckoutArgs({ url: 'https://x/svn/p', target: 'C:\\w' });
    expect(args).not.toContain('--password');
    expect(args).not.toContain('--username');
  });

  it('rejects NUL with a generic message that does not echo the password', () => {
    const secret = 'sec\u0000ret';
    expect(() =>
      buildCheckoutArgs({
        url: 'https://x',
        target: 'C:\\w',
        username: 'u',
        password: secret,
      }),
    ).toThrowError(/^Invalid characters in credentials$/);
  });
});
