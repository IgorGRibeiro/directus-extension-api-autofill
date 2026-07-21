import { defineInterface } from '@directus/extensions-sdk';
import InterfaceComponent from './interface.vue';

function mappingFields(collection: string | undefined) {
  const targetMeta = collection
    ? { interface: 'system-field', options: { collectionName: collection, allowNone: false } }
    : { interface: 'input', options: { placeholder: 'target_field_key' } };

  return [
    {
      field: 'field_source',
      type: 'string',
      name: 'Source path',
      meta: {
        width: 'half',
        interface: 'input',
        options: { placeholder: 'data.name', font: 'monospace' },
      },
    },
    {
      field: 'field_target',
      type: 'string',
      name: 'Target field',
      meta: { width: 'half', ...targetMeta },
    },
  ];
}

export default defineInterface({
  id: 'api-autofill-input',
  name: 'API Autofill',
  icon: 'sync',
  description: 'Text input that queries an external API and autofills sibling fields.',
  component: InterfaceComponent as unknown as never,
  types: ['string', 'text'],
  options: ({ collection }: { collection?: string } = {}) => [
    {
      field: 'url',
      name: 'Request URL',
      type: 'string',
      meta: {
        width: 'full',
        interface: 'input',
        note: 'Rendered with Liquid. Variables: {{ value }} (typed text) and {{ env.VAR }} (server env). Not auto-encoded — use {{ value | url_encode }} in query strings.',
        options: { placeholder: 'https://api.example.com/lookup?q={{ value | url_encode }}' },
      },
    },
    {
      field: 'method',
      name: 'Method',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'select-dropdown',
        options: { choices: [{ text: 'GET', value: 'GET' }, { text: 'POST', value: 'POST' }] },
      },
      schema: { default_value: 'GET' },
    },
    {
      field: 'headers',
      name: 'Headers',
      type: 'json',
      meta: {
        width: 'full',
        interface: 'list',
        note: 'Header values are rendered with Liquid — e.g. Bearer {{ env.API_TOKEN }}.',
        options: {
          addLabel: 'Add header',
          template: '{{ name }}',
          fields: [
            { field: 'name', type: 'string', name: 'Name', meta: { width: 'half', interface: 'input', options: { placeholder: 'Authorization' } } },
            { field: 'value', type: 'string', name: 'Value', meta: { width: 'half', interface: 'input', options: { placeholder: 'Bearer {{env.API_TOKEN}}' } } },
          ],
        },
      },
    },
    {
      field: 'body',
      name: 'Request Body (JSON)',
      type: 'text',
      meta: {
        width: 'full',
        interface: 'input-code',
        note: 'POST only. Rendered with Liquid — use {{ value | json }} to embed the value as valid JSON.',
        options: { language: 'json' },
        hidden: true,
        conditions: [
          { name: 'Shown for POST', rule: { method: { _eq: 'POST' } }, hidden: false },
        ],
      },
    },
    {
      field: 'debounceMs',
      name: 'Debounce (ms)',
      type: 'integer',
      meta: { width: 'half', interface: 'input' },
      schema: { default_value: 500 },
    },
    {
      field: 'triggerRegex',
      name: 'Trigger Regex',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Optional. Search only fires when the typed value matches this pattern.',
        options: { placeholder: '^\\d{8}$', font: 'monospace' },
      },
    },
    {
      field: 'mappings',
      name: 'Field Mappings',
      type: 'json',
      meta: {
        width: 'full',
        interface: 'list',
        note: 'Map a path in the API response (source) to a field in this collection (target). Source may also be a Liquid template, e.g. {{ first_name }} {{ last_name }}.',
        options: {
          addLabel: 'Add mapping',
          template: '{{ field_source }} → {{ field_target }}',
          fields: mappingFields(collection),
        },
      },
    },
  ],
});
