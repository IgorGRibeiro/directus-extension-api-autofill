import { getByPath } from './json-path.js';

export interface Mapping {
  field_source: string;
  field_target: string;
}

export interface FieldUpdate {
  field: string;
  value: unknown;
}

export function resolveMappings(data: unknown, mappings: Mapping[]): FieldUpdate[] {
  const updates: FieldUpdate[] = [];
  for (const mapping of mappings ?? []) {
    if (!mapping?.field_target || !mapping?.field_source) continue;
    const value = getByPath(data, mapping.field_source);
    if (value === null || value === undefined) continue;
    updates.push({ field: mapping.field_target, value });
  }
  return updates;
}
