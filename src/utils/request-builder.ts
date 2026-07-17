import { substituteValue, resolveEnv } from './template.js';

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

export function buildRequest(
  options: AutofillOptions,
  value: string,
  env: Record<string, string | undefined>,
): BuiltRequest {
  const method: 'GET' | 'POST' = options.method === 'POST' ? 'POST' : 'GET';

  const url = resolveEnv(substituteValue(options.url, value, { encode: true }), env);

  const headers: Record<string, string> = {};
  let hasContentType = false;
  for (const header of options.headers ?? []) {
    if (!header?.name) continue;
    headers[header.name] = resolveEnv(substituteValue(header.value ?? '', value), env);
    if (header.name.toLowerCase() === 'content-type') hasContentType = true;
  }

  let body: string | undefined;
  if (method === 'POST' && options.body) {
    body = substituteValue(options.body, value);
    if (!hasContentType) headers['Content-Type'] = 'application/json';
  }

  return { url, method, headers, body };
}
