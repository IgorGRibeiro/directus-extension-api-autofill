import { describe, it, expect } from 'vitest';
import { buildRequest } from './request-builder.js';
import { MissingEnvError } from './template.js';

describe('buildRequest', () => {
  it('builds a GET with an encoded value in the URL and no body', () => {
    const result = buildRequest({ url: 'https://x/y?q={{value}}', method: 'GET' }, 'a b', {});
    expect(result).toEqual({ url: 'https://x/y?q=a%20b', method: 'GET', headers: {}, body: undefined });
  });

  it('defaults the method to GET when omitted', () => {
    expect(buildRequest({ url: 'https://x' }, 'v', {}).method).toBe('GET');
  });

  it('builds a POST with a substituted body and default Content-Type', () => {
    const result = buildRequest(
      { url: 'https://x', method: 'POST', body: '{"q":"{{value}}"}' },
      'hi',
      {},
    );
    expect(result.method).toBe('POST');
    expect(result.body).toBe('{"q":"hi"}');
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('resolves env references in header values', () => {
    const result = buildRequest(
      { url: 'https://x', headers: [{ name: 'Authorization', value: 'Bearer {{env.TOKEN}}' }] },
      'v',
      { TOKEN: 't' },
    );
    expect(result.headers.Authorization).toBe('Bearer t');
  });

  it('does not override a supplied Content-Type header for POST bodies', () => {
    const result = buildRequest(
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

  it('throws MissingEnvError when a header references an unset variable', () => {
    expect(() =>
      buildRequest({ url: 'https://x', headers: [{ name: 'Authorization', value: '{{env.NOPE}}' }] }, 'v', {}),
    ).toThrow(MissingEnvError);
  });
});
