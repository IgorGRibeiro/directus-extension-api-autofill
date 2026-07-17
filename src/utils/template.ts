export class MissingEnvError extends Error {
  readonly varName: string;
  constructor(varName: string) {
    super(`Missing environment variable: ${varName}`);
    this.name = 'MissingEnvError';
    this.varName = varName;
  }
}

const VALUE_PATTERN = /\{\{\s*value\s*\}\}/g;
const ENV_PATTERN = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function substituteValue(input: string, value: string, opts?: { encode?: boolean }): string {
  const replacement = opts?.encode ? encodeURIComponent(value) : value;
  return input.replace(VALUE_PATTERN, replacement);
}

export function resolveEnv(input: string, env: Record<string, string | undefined>): string {
  return input.replace(ENV_PATTERN, (_match, name: string) => {
    const resolved = env[name];
    if (resolved === undefined) throw new MissingEnvError(name);
    return resolved;
  });
}
