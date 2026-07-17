import { defineEndpoint } from '@directus/extensions-sdk';

export default defineEndpoint({
  id: 'api-autofill',
  handler: (router) => {
    router.post('/search', (_req: any, res: any) => {
      return res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } });
    });
  },
});
