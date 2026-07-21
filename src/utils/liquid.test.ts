import { describe, it, expect } from 'vitest';
import { renderTemplate, renderTemplateSync, isTemplate, TemplateError } from './liquid.js';

describe('renderTemplate', () => {
  it('renders a plain value from scope', async () => {
    expect(await renderTemplate('{{ value }}', { value: 'hi', env: {} })).toBe('hi');
  });

  it('applies the upcase filter', async () => {
    expect(await renderTemplate('{{ value | upcase }}', { value: 'hi', env: {} })).toBe('HI');
  });

  it('url_encode encodes unsafe characters', async () => {
    expect(await renderTemplate('{{ value | url_encode }}', { value: 'a/b', env: {} })).toBe('a%2Fb');
  });

  it('json filter produces a valid JSON string', async () => {
    const out = await renderTemplate('{{ value | json }}', { value: 'he "said"', env: {} });
    expect(JSON.parse(out)).toBe('he "said"');
  });

  it('resolves env values from scope', async () => {
    expect(await renderTemplate('{{ env.TOKEN }}', { value: '', env: { TOKEN: 'abc' } })).toBe('abc');
  });

  it('throws TemplateError naming an undefined top-level variable', async () => {
    const err = await renderTemplate('{{ missing }}', { value: 'x', env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.variableName).toContain('missing');
  });

  it('throws TemplateError for a missing key on the env object (nested)', async () => {
    const err = await renderTemplate('{{ env.NOPE }}', { value: 'x', env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect(err.variableName).toContain('NOPE');
  });
});

describe('isTemplate', () => {
  it('detects Liquid output and tag syntax', () => {
    expect(isTemplate('{{ x }}')).toBe(true);
    expect(isTemplate('{% if x %}a{% endif %}')).toBe(true);
  });

  it('is false for a plain dot-path', () => {
    expect(isTemplate('data.city')).toBe(false);
  });
});

describe('renderTemplateSync', () => {
  it('applies a filter from scope', () => {
    expect(renderTemplateSync('{{ a | upcase }}', { a: 'hi' })).toBe('HI');
  });

  it('renders an undefined variable as empty string (lenient)', () => {
    expect(renderTemplateSync('{{ missing }}', {})).toBe('');
  });
});
