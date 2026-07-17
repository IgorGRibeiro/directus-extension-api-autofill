import { describe, it, expect } from 'vitest';
import { getByPath } from './json-path.js';

describe('getByPath', () => {
  it('resolves a nested object path', () => {
    expect(getByPath({ data: { name: 'John' } }, 'data.name')).toBe('John');
  });

  it('resolves array indices with numeric segments', () => {
    expect(getByPath({ data: { results: [{ cep: '123' }] } }, 'data.results.0.cep')).toBe('123');
  });

  it('returns undefined for a missing path', () => {
    expect(getByPath({ a: { b: 1 } }, 'a.x')).toBeUndefined();
  });

  it('returns undefined when the input is not an object', () => {
    expect(getByPath(null, 'a')).toBeUndefined();
    expect(getByPath('str', 'a')).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(getByPath({ a: 1 }, '')).toBeUndefined();
  });

  it('preserves falsy leaf values', () => {
    expect(getByPath({ a: { b: 0 } }, 'a.b')).toBe(0);
    expect(getByPath({ a: { b: false } }, 'a.b')).toBe(false);
  });
});
