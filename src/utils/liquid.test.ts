import { describe, it, expect } from 'vitest';
import { renderTemplate, TemplateError } from './liquid.js';

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
