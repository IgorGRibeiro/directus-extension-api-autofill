import { defineInterface } from '@directus/extensions-sdk';
import InterfaceComponent from './interface.vue';

export default defineInterface({
  id: 'api-autofill-input',
  name: 'API Autofill',
  icon: 'sync',
  description: 'Text input that queries an external API and autofills sibling fields.',
  component: InterfaceComponent as unknown as never,
  types: ['string', 'text'],
  options: [],
});
