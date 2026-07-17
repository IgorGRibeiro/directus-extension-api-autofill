import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  test: {
    alias: {
      'directus:api': fileURLToPath(
        new URL('./src/__mocks__/directus-api.ts', import.meta.url),
      ),
    },
  },
});
