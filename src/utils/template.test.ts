import { describe, it, expect } from 'vitest';
import { substituteValue, resolveEnv, MissingEnvError } from './template.js';

describe('substituteValue', () => {
  it('URL-encodes when encode is true', () => {
    expect(substituteValue('q={{value}}', 'a b', { encode: true })).toBe('q=a%20b');
  });

  it('inserts raw when encode is false/omitted', () => {
    expect(substituteValue('{"q":"{{value}}"}', 'a b')).toBe('{"q":"a b"}');
  });

  it('replaces every occurrence', () => {
    expect(substituteValue('{{value}}-{{value}}', 'x')).toBe('x-x');
  });

  it('leaves text without placeholders untouched', () => {
    expect(substituteValue('none', 'x')).toBe('none');
  });
});

describe('resolveEnv', () => {
  it('replaces a single env reference', () => {
    expect(resolveEnv('Bearer {{env.TOKEN}}', { TOKEN: 'abc' })).toBe('Bearer abc');
  });

  it('replaces multiple env references', () => {
    expect(resolveEnv('{{env.A}}/{{env.B}}', { A: '1', B: '2' })).toBe('1/2');
  });

  it('leaves text without references untouched', () => {
    expect(resolveEnv('no vars', {})).toBe('no vars');
  });

  it('throws MissingEnvError naming the missing variable', () => {
    try {
      resolveEnv('{{env.MISSING}}', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as MissingEnvError).varName).toBe('MISSING');
    }
  });
});
