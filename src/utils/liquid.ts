import { Liquid } from 'liquidjs';

export type EnvRecord = Record<string, string | undefined>;

export interface TemplateScope {
  value: string;
  env: EnvRecord;
}

export class TemplateError extends Error {
  readonly variableName?: string;
  constructor(message: string, variableName?: string) {
    super(message);
    this.name = 'TemplateError';
    this.variableName = variableName;
  }
}

const engine = new Liquid({ strictVariables: true });

function extractVariableName(err: unknown): string | undefined {
  const anyErr = err as { variableName?: unknown; message?: unknown };
  if (typeof anyErr?.variableName === 'string') return anyErr.variableName;
  const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
  const match = /undefined variable:\s*([^\s,]+)/i.exec(message);
  return match?.[1];
}

export async function renderTemplate(src: string, scope: TemplateScope): Promise<string> {
  try {
    return await engine.parseAndRender(src, scope);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? 'Template render failed';
    throw new TemplateError(message, extractVariableName(err));
  }
}

// Response-side templating (field-mapping sources) uses a separate, lenient
// engine: undefined variables render as an empty string instead of throwing,
// since a response field being absent is an expected, non-fatal case here —
// the opposite policy from the strict request-side `engine` above.
const lenientEngine = new Liquid({ strictVariables: false });

export function isTemplate(src: string): boolean {
  return /\{\{|\{%/.test(src);
}

export function renderTemplateSync(src: string, scope: object): string {
  return lenientEngine.parseAndRenderSync(src, scope);
}
