import { getByPath } from './json-path.js';
import { isTemplate, renderTemplateSync } from './liquid.js';

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
  const scope = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  for (const mapping of mappings ?? []) {
    if (!mapping?.field_target || !mapping?.field_source) continue;

    if (isTemplate(mapping.field_source)) {
      let rendered: string;
      try {
        rendered = renderTemplateSync(mapping.field_source, scope);
      } catch {
        // Malformed template: skip only this mapping, never break the autofill.
        continue;
      }
      if (rendered === '') continue;
      updates.push({ field: mapping.field_target, value: rendered });
      continue;
    }

    const value = getByPath(data, mapping.field_source);
    if (value === null || value === undefined) continue;
    updates.push({ field: mapping.field_target, value });
  }

  return updates;
}
