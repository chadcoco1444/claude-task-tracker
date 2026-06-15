import { describe, it, expect } from 'vitest';
import { basename, shortId } from '../src/util';

describe('basename', () => {
  it('returns the last path segment, handling slashes and trailing slashes', () => {
    expect(basename('/a/b/c')).toBe('c');
    expect(basename('C:\\ws\\proj\\')).toBe('proj');
    expect(basename('solo')).toBe('solo');
  });
});

describe('shortId', () => {
  it('returns the first hyphen segment, or the whole string when none', () => {
    expect(shortId('448dc281-9db9-4cd0')).toBe('448dc281');
    expect(shortId('nohyphen')).toBe('nohyphen');
  });
});
