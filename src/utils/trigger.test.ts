import { describe, it, expect } from 'vitest';
import { shouldSearch } from './trigger.js';

describe('shouldSearch', () => {
  it('is false for an empty or whitespace value', () => {
    expect(shouldSearch('', null)).toBe(false);
    expect(shouldSearch('   ', null)).toBe(false);
  });

  it('is false when the value equals the last searched value (dedup)', () => {
    expect(shouldSearch('abc', 'abc')).toBe(false);
  });

  it('is true for a new value with no regex gate', () => {
    expect(shouldSearch('abc', null)).toBe(true);
  });

  it('respects a valid regex gate', () => {
    expect(shouldSearch('12345678', null, '^\\d{8}$')).toBe(true);
    expect(shouldSearch('123', null, '^\\d{8}$')).toBe(false);
  });

  it('treats an invalid regex as no gate', () => {
    expect(shouldSearch('abc', null, '[')).toBe(true);
  });
});
