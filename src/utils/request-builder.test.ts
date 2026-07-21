import { describe, it, expect } from 'vitest';
import { buildRequest } from './request-builder.js';
import { TemplateError } from './liquid.js';

describe('buildRequest', () => {
  it('renders the URL without implicit encoding', async () => {
    const result = await buildRequest({ url: 'https://x/y?q={{ value }}', method: 'GET' }, 'a/b', {});
    expect(result.url).toBe('https://x/y?q=a/b');
    expect(result.method).toBe('GET');
    expect(result.body).toBeUndefined();
  });

  it('encodes the value in the URL when url_encode is used', async () => {
    const result = await buildRequest(
      { url: 'https://x/y?q={{ value | url_encode }}', method: 'GET' },
      'a/b',
      {},
    );
    expect(result.url).toBe('https://x/y?q=a%2Fb');
  });

  it('defaults the method to GET when omitted', async () => {
    const result = await buildRequest({ url: 'https://x' }, 'v', {});
    expect(result.method).toBe('GET');
  });

  it('builds a POST body with the json filter and default Content-Type', async () => {
    const result = await buildRequest(
      { url: 'https://x', method: 'POST', body: '{"q": {{ value | json }}}' },
      'he "said"',
      {},
    );
    expect(result.method).toBe('POST');
    expect(JSON.parse(result.body as string)).toEqual({ q: 'he "said"' });
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('resolves env references in header values', async () => {
    const result = await buildRequest(
      { url: 'https://x', headers: [{ name: 'Authorization', value: 'Bearer {{ env.TOKEN }}' }] },
      'v',
      { TOKEN: 't' },
    );
    expect(result.headers.Authorization).toBe('Bearer t');
  });

  it('does not override a supplied Content-Type header for POST bodies', async () => {
    const result = await buildRequest(
      {
        url: 'https://x',
        method: 'POST',
        body: 'a=1',
        headers: [{ name: 'content-type', value: 'application/x-www-form-urlencoded' }],
      },
      'v',
      {},
    );
    expect(result.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(result.headers['Content-Type']).toBeUndefined();
  });

  it('throws TemplateError when a header references an unset env variable', async () => {
    const err = await buildRequest(
      { url: 'https://x', headers: [{ name: 'Authorization', value: '{{ env.NOPE }}' }] },
      'v',
      {},
    ).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
  });
});
