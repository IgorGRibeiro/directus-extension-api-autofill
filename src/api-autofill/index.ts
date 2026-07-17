import { defineEndpoint } from '@directus/extensions-sdk';
import { buildRequest, type AutofillOptions } from '../utils/request-builder.js';
import { MissingEnvError } from '../utils/template.js';

const INTERFACE_ID = 'api-autofill-input';
const TIMEOUT_MS = 10_000;

export default defineEndpoint({
  id: 'api-autofill',
  handler: (router, { services, getSchema, env }) => {
    router.post('/search', async (req: any, res: any) => {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
      }

      const { collection, field, value } = req.body ?? {};
      if (!collection || !field || typeof value !== 'string') {
        return res
          .status(400)
          .json({ error: { code: 'NOT_CONFIGURED', message: 'collection, field and value are required.' } });
      }

      let schema;
      try {
        schema = await getSchema();
      } catch (err: any) {
        return res
          .status(500)
          .json({ error: { code: 'INTERNAL_ERROR', message: err?.message ?? 'Failed to load schema.' } });
      }

      // Load the field under the requester's accountability: no more reach than the user has.
      let fieldEntry: any;
      try {
        const { FieldsService } = services;
        const fieldsService = new FieldsService({
          schema,
          accountability: req.accountability,
        });
        fieldEntry = await fieldsService.readOne(collection, field);
      } catch {
        return res
          .status(403)
          .json({ error: { code: 'FORBIDDEN', message: 'Field not accessible.' } });
      }

      if (fieldEntry?.meta?.interface !== INTERFACE_ID) {
        return res
          .status(400)
          .json({ error: { code: 'NOT_CONFIGURED', message: 'Field is not an API Autofill field.' } });
      }

      const options = (fieldEntry.meta.options ?? {}) as AutofillOptions;
      if (!options.url) {
        return res
          .status(400)
          .json({ error: { code: 'NOT_CONFIGURED', message: 'No request URL configured.' } });
      }

      let built;
      try {
        built = buildRequest(options, value, env as Record<string, string | undefined>);
      } catch (err) {
        if (err instanceof MissingEnvError) {
          return res.status(400).json({
            error: { code: 'NOT_CONFIGURED', message: `Server env var not set: ${err.varName}` },
          });
        }
        throw err;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const upstream = await fetch(built.url, {
          method: built.method,
          headers: built.headers,
          body: built.body,
          signal: controller.signal,
        });

        if (!upstream.ok) {
          return res.status(502).json({
            error: { code: 'UPSTREAM_ERROR', message: `Upstream responded ${upstream.status}.` },
          });
        }

        let data: unknown;
        try {
          data = await upstream.json();
        } catch {
          return res
            .status(502)
            .json({ error: { code: 'UPSTREAM_ERROR', message: 'Upstream response was not valid JSON.' } });
        }

        return res.json({ data });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return res.status(504).json({ error: { code: 'TIMEOUT', message: 'Upstream request timed out.' } });
        }
        return res
          .status(502)
          .json({ error: { code: 'UPSTREAM_ERROR', message: err?.message ?? 'Upstream request failed.' } });
      } finally {
        clearTimeout(timer);
      }
    });
  },
});
