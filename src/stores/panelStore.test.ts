import { describe, expect, it } from 'vitest';
import { quoteCmdArg } from './panelStore';

describe('quoteCmdArg', () => {
  it('wraps a plain argument with no special characters in quotes', () => {
    expect(quoteCmdArg('checkout')).toBe('"checkout"');
  });

  it('quotes an argument containing spaces', () => {
    expect(quoteCmdArg('C:\\work\\my project')).toBe('"C:\\work\\my project"');
  });

  it('escapes an embedded double quote', () => {
    expect(quoteCmdArg('p"ss')).toBe('"p\\"ss"');
  });

  it('neutralizes an ampersand so cmd.exe cannot chain a second command', () => {
    expect(quoteCmdArg('p&x')).toBe('"p^&x"');
  });

  it('passes through a hash and non-ASCII character safely', () => {
    expect(quoteCmdArg('p#ss ä')).toBe('"p#ss ä"');
  });

  it('handles the full reported password: quote, space, ampersand, hash, umlaut', () => {
    const password = 'p"ss &x#ä 1';
    expect(quoteCmdArg(password)).toBe('"p\\"ss ^&x#ä 1"');
  });

  it('doubles a trailing backslash that sits right before the closing quote', () => {
    // A single trailing backslash would otherwise escape the closing quote.
    expect(quoteCmdArg('C:\\work\\')).toBe('"C:\\work\\\\"');
  });

  it('doubles backslashes that immediately precede an embedded quote', () => {
    expect(quoteCmdArg('a\\"b')).toBe('"a\\\\\\"b"');
  });
});
