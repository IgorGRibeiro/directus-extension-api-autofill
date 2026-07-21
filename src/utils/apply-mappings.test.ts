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

  it('renders a Liquid-template source with a filter', () => {
    expect(
      resolveMappings({ name: 'john' }, [{ field_source: '{{ name | upcase }}', field_target: 'x' }]),
    ).toEqual([{ field: 'x', value: 'JOHN' }]);
  });

  it('joins two response fields in one template', () => {
    expect(
      resolveMappings({ first: 'Ada', last: 'Lovelace' }, [
        { field_source: '{{ first }} {{ last }}', field_target: 'full' },
      ]),
    ).toEqual([{ field: 'full', value: 'Ada Lovelace' }]);
  });

  it('keeps a partially-rendered template', () => {
    expect(
      resolveMappings({ first: 'Ada' }, [{ field_source: '{{ first }} {{ last }}', field_target: 'x' }]),
    ).toEqual([{ field: 'x', value: 'Ada ' }]);
  });

  it('skips a template that renders empty (all vars missing)', () => {
    expect(resolveMappings({}, [{ field_source: '{{ nope }}', field_target: 'x' }])).toEqual([]);
  });

  it('skips a malformed template without throwing', () => {
    expect(resolveMappings({ a: 'x' }, [{ field_source: '{{ a', field_target: 'x' }])).toEqual([]);
  });

  it('handles raw paths and templates together', () => {
    const data = { name: 'john', city: 'NY' };
    const mappings = [
      { field_source: 'name', field_target: 'name' },
      { field_source: '{{ city | upcase }}', field_target: 'city_uc' },
    ];
    expect(resolveMappings(data, mappings)).toEqual([
      { field: 'name', value: 'john' },
      { field: 'city_uc', value: 'NY' },
    ]);
  });
});
