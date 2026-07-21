import { renderTemplate, type EnvRecord, type TemplateScope } from './liquid.js';

export interface AutofillOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Array<{ name: string; value: string }>;
  body?: string;
}

export interface BuiltRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export async function buildRequest(
  options: AutofillOptions,
  value: string,
  env: EnvRecord,
): Promise<BuiltRequest> {
  const method: 'GET' | 'POST' = options.method === 'POST' ? 'POST' : 'GET';
  const scope: TemplateScope = { value, env };

  const url = await renderTemplate(options.url, scope);

  const headers: Record<string, string> = {};
  let hasContentType = false;
  for (const header of options.headers ?? []) {
    if (!header?.name) continue;
    headers[header.name] = await renderTemplate(header.value ?? '', scope);
    if (header.name.toLowerCase() === 'content-type') hasContentType = true;
  }

  let body: string | undefined;
  if (method === 'POST' && options.body) {
    body = await renderTemplate(options.body, scope);
    if (!hasContentType) headers['Content-Type'] = 'application/json';
  }

  return { url, method, headers, body };
}
