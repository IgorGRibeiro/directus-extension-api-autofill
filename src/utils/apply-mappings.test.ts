import { describe, it, expect } from 'vitest';
import { resolveMappings } from './apply-mappings.js';

describe('resolveMappings', () => {
  it('maps multiple source paths to target fields', () => {
    const data = { data: { name: 'John', city: 'NY' } };
    const mappings = [
      { field_source: 'data.name', field_target: 'name' },
      { field_source: 'data.city', field_target: 'city' },
    ];
    expect(resolveMappings(data, mappings)).toEqual([
      { field: 'name', value: 'John' },
      { field: 'city', value: 'NY' },
    ]);
  });

  it('skips rows whose source path is missing', () => {
    expect(resolveMappings({ data: {} }, [{ field_source: 'data.name', field_target: 'name' }])).toEqual([]);
  });

  it('skips rows whose resolved value is null', () => {
    expect(resolveMappings({ a: null }, [{ field_source: 'a', field_target: 'x' }])).toEqual([]);
  });

  it('skips rows with an empty target', () => {
    expect(resolveMappings({ a: 1 }, [{ field_source: 'a', field_target: '' }])).toEqual([]);
  });

  it('keeps falsy-but-present values', () => {
    expect(resolveMappings({ a: 0 }, [{ field_source: 'a', field_target: 'x' }])).toEqual([
      { field: 'x', value: 0 },
    ]);
  });
});
