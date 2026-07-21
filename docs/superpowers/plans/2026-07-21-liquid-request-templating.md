# Liquid Request Templating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `{{value}}`/`{{env.VAR}}` substitution engine with LiquidJS so the outbound request's URL, headers, and body can be transformed with Liquid filters.

**Architecture:** A single server-side LiquidJS engine (strict mode) renders each request surface against a `{ value, env }` scope. A new `liquid.ts` util owns the engine and a `renderTemplate` helper; `request-builder.ts` becomes async and calls it for URL/headers/body; the endpoint awaits it and maps undefined-variable failures to `NOT_CONFIGURED`. The old `template.ts` is deleted. Task 4 adds response-side templating: a second lenient, synchronous engine renders a field mapping's source when it looks like a Liquid template — so LiquidJS ships in both `dist/api.js` and `dist/app.js`.

**Tech Stack:** TypeScript, ES modules, Vue 3 (unchanged here), Directus Extensions SDK, LiquidJS, Vitest.

## Global Constraints

- **Dependency:** add `liquidjs` `^10.27.2` to `dependencies` (runtime, server-only). It ships its own TypeScript types — no `@types` package.
- **Engine config:** one shared instance, `new Liquid({ strictVariables: true })`. `ownPropertyOnly` stays at its default (`true`).
- **Template scope:** exactly `{ value, env }` — `value` is the typed string, `env` is the server env record.
- **Undefined variable ⇒ error:** any undefined reference (missing env var or typo) throws `TemplateError`; the endpoint returns HTTP 400 `{ code: 'NOT_CONFIGURED' }` naming the variable. This is enforced by `strictVariables` (with `ownPropertyOnly`, a missing key on the `env` object also throws — the spec's Proxy fallback proved unnecessary; the test in Task 1 confirms it).
- **URL encoding:** the URL is no longer auto-encoded. Query-string values must use `{{ value | url_encode }}` (form-encoding: space → `+`, `/` → `%2F`).
- **Request side (Tasks 1–3):** server-only; does not touch `interface.vue`, `apply-mappings.ts`, or any i18n, and adds no new user-facing runtime strings.
- **Response side (Task 4):** `apply-mappings.ts` gains opt-in Liquid rendering via a **lenient**, synchronous engine (`strictVariables: false`, `parseAndRenderSync`). `resolveMappings` stays synchronous, so `interface.vue` and i18n are untouched. A source is treated as a template only when it contains `{{` or `{%`; plain dot-paths keep their current native-type extraction.
- **Imports:** ES modules; local imports carry the `.js` extension (e.g. `./liquid.js`).
- **Language:** all option `note`/`placeholder` copy and README text in English (matches existing code).
- **Tests:** Vitest unit tests only, co-located as `*.test.ts`. `npm run test` runs `vitest run`.
- **Commit prefixes:** `feat:` for engine/request changes, `docs:` for documentation. (The URL-encoding change is technically breaking; if a major version bump is wanted, use `feat!:` on Task 2's commit instead. Default kept as `feat:`.)

---

### Task 1: LiquidJS engine util (`liquid.ts`)

**Files:**
- Modify: `package.json` (add `liquidjs` dependency) + `package-lock.json` (via npm)
- Create: `src/utils/liquid.ts`
- Test: `src/utils/liquid.test.ts`

**Interfaces:**
- Consumes: LiquidJS `Liquid` class.
- Produces (used by Task 2):
  - `type EnvRecord = Record<string, string | undefined>`
  - `interface TemplateScope { value: string; env: EnvRecord }`
  - `class TemplateError extends Error { readonly variableName?: string; constructor(message: string, variableName?: string) }`
  - `function renderTemplate(src: string, scope: TemplateScope): Promise<string>`

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install liquidjs@^10.27.2
```
Expected: `liquidjs` appears under `dependencies` in `package.json`; `package-lock.json` updated. Confirm:
```bash
node -p "require('./package.json').dependencies.liquidjs"
```
Expected: prints a `^10.x` version string.

- [ ] **Step 2: Write the failing test**

Create `src/utils/liquid.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npx vitest run src/utils/liquid.test.ts
```
Expected: FAIL — cannot resolve `./liquid.js` (module does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `src/utils/liquid.ts`:
```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
npx vitest run src/utils/liquid.test.ts
```
Expected: PASS — all 7 tests green.

Note on the two "throws" tests: they verify the strict-mode contract from Global Constraints. `strictVariables` throws for the undefined top-level variable, and `strictVariables` + `ownPropertyOnly` throws for the missing `env` key (LiquidJS reads a non-own property as `undefined`, which strict mode then rejects). If the nested test unexpectedly does NOT throw, stop and report — it is a blocking assumption, not something to work around silently. If `variableName` comes back empty (LiquidJS message format differs from the regex), widen `extractVariableName`'s regex to match the actual message rather than loosening the test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/utils/liquid.ts src/utils/liquid.test.ts
git commit -m "feat: add Liquid template engine util for request building"
```

---

### Task 2: Render URL, headers and body with Liquid

**Files:**
- Modify: `src/utils/request-builder.ts` (make async, render via Liquid)
- Test: `src/utils/request-builder.test.ts` (rewrite for async + Liquid)
- Modify: `src/api-autofill/index.ts` (await `buildRequest`; catch `TemplateError`)
- Delete: `src/utils/template.ts`, `src/utils/template.test.ts`

**Interfaces:**
- Consumes (from Task 1): `renderTemplate`, `TemplateError`, `EnvRecord`, `TemplateScope`.
- Produces (used by the endpoint):
  - `async function buildRequest(options: AutofillOptions, value: string, env: EnvRecord): Promise<BuiltRequest>`
  - `interface AutofillOptions { url: string; method?: 'GET' | 'POST'; headers?: Array<{ name: string; value: string }>; body?: string }` (unchanged)
  - `interface BuiltRequest { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }` (unchanged)

- [ ] **Step 1: Rewrite the request-builder test (failing)**

Replace the entire contents of `src/utils/request-builder.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/utils/request-builder.test.ts
```
Expected: FAIL — the current sync `buildRequest` auto-encodes `{{ value }}` and cannot parse `| url_encode` / `| json`, so the URL, body, and encoding assertions fail.

- [ ] **Step 3: Rewrite the request-builder implementation**

Replace the entire contents of `src/utils/request-builder.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/utils/request-builder.test.ts
```
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Update the endpoint to await and catch `TemplateError`**

In `src/api-autofill/index.ts`:

Replace the import line:
```ts
import { MissingEnvError } from '../utils/template.js';
```
with:
```ts
import { TemplateError, type EnvRecord } from '../utils/liquid.js';
```

Replace the request-building block:
```ts
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
```
with:
```ts
      let built;
      try {
        built = await buildRequest(options, value, env as EnvRecord);
      } catch (err) {
        if (err instanceof TemplateError) {
          const detail = err.variableName ? `Undefined variable: ${err.variableName}` : err.message;
          return res.status(400).json({ error: { code: 'NOT_CONFIGURED', message: detail } });
        }
        throw err;
      }
```

- [ ] **Step 6: Delete the old template module and confirm no stale imports**

Run:
```bash
git rm src/utils/template.ts src/utils/template.test.ts
grep -rn "template.js\|MissingEnvError\|substituteValue\|resolveEnv" src
```
Expected: `grep` prints nothing (no remaining references). If it prints anything, fix that import before continuing.

- [ ] **Step 7: Run the full suite and build**

Run:
```bash
npm run test && npm run build
```
Expected: all Vitest tests pass; `directus-extension build` completes without TypeScript errors (this validates the endpoint's `await`/type changes, which have no unit test).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: render request URL, headers and body with Liquid"
```

---

### Task 3: Update documentation (option notes + README)

**Files:**
- Modify: `src/api-autofill-input/index.ts` (option `note` / `placeholder` copy)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (copy only).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the option notes in `src/api-autofill-input/index.ts`**

Request URL option — replace:
```ts
        note: 'Supports {{value}} (the typed text) and {{env.VAR}} (resolved on the server).',
        options: { placeholder: 'https://api.example.com/lookup?q={{value}}' },
```
with:
```ts
        note: 'Rendered with Liquid. Variables: {{ value }} (typed text) and {{ env.VAR }} (server env). Not auto-encoded — use {{ value | url_encode }} in query strings.',
        options: { placeholder: 'https://api.example.com/lookup?q={{ value | url_encode }}' },
```

Headers option — replace:
```ts
        note: 'Header values support {{value}} and {{env.VAR}}.',
```
with:
```ts
        note: 'Header values are rendered with Liquid — e.g. Bearer {{ env.API_TOKEN }}.',
```

Request Body option — replace:
```ts
        note: 'POST only. Supports {{value}}.',
```
with:
```ts
        note: 'POST only. Rendered with Liquid — use {{ value | json }} to embed the value as valid JSON.',
```

- [ ] **Step 2: Verify the notes change compiles**

Run:
```bash
npm run build
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Update the README options table (`README.md`)**

Replace the Request URL row:
```markdown
| Request URL          | The endpoint to call. Supports `{{value}}` (the typed text, URL-encoded) and `{{env.VAR}}` (resolved on the server)             |
```
with:
```markdown
| Request URL          | The endpoint to call. Rendered with [Liquid](https://liquidjs.com): `{{ value }}` is the typed text, `{{ env.VAR }}` a server env var. The value is **not** auto-encoded — use `{{ value \| url_encode }}` in query strings |
```

Replace the Headers row:
```markdown
| Headers              | Repeatable name/value pairs. Values support `{{value}}` and `{{env.VAR}}` — use this for API keys                               |
```
with:
```markdown
| Headers              | Repeatable name/value pairs. Values are rendered with Liquid — e.g. `Bearer {{ env.API_TOKEN }}` for API keys                   |
```

Replace the Request Body row:
```markdown
| Request Body (JSON)  | POST only. Supports `{{value}}`. `Content-Type: application/json` is added automatically unless you set it yourself             |
```
with:
```markdown
| Request Body (JSON)  | POST only. Rendered with Liquid — use `{{ value \| json }}` to embed the value as a valid JSON string. `Content-Type: application/json` is added automatically unless you set it yourself |
```

- [ ] **Step 4: Add a Liquid feature bullet and a templating note**

In the **Features** list, insert a new bullet immediately after the `- **Any JSON API** …` line:
```markdown
- **Liquid templating** — shape the outbound request (URL, headers, body) with [Liquid](https://liquidjs.com) filters like `upcase`, `json`, and `url_encode`
```

Immediately after the options table (after the `| Field Mappings … |` row and its trailing blank line, before the `**Field Mappings** is where the response becomes form data.` paragraph), insert:
```markdown
The **Request URL**, **Headers**, and **Request Body** are rendered with the [Liquid](https://liquidjs.com) template engine. Two variables are in scope: `value` (the typed text) and `env` (server environment variables). Use Liquid filters to format what you send — for example `{{ value | upcase }}`, `{{ value | url_encode }}` in a query string, or `{{ value | json }}` to embed the value safely in a JSON body. Referencing a variable that is not set — a missing env var or a typo — aborts the lookup with a configuration error.

```

- [ ] **Step 5: Update the two example configs**

In "Example — Brazilian postal code (ViaCEP)", replace:
```markdown
| Request URL    | `https://viacep.com.br/ws/{{value}}/json/`  |
```
with:
```markdown
| Request URL    | `https://viacep.com.br/ws/{{ value }}/json/`  |
```

In "Example — authenticated API", replace:
```markdown
| Request URL | `https://api.example.com/lookup?q={{value}}`   |
| Headers     | `Authorization` → `Bearer {{env.API_TOKEN}}`   |
```
with:
```markdown
| Request URL | `https://api.example.com/lookup?q={{ value \| url_encode }}` |
| Headers     | `Authorization` → `Bearer {{ env.API_TOKEN }}` |
```

- [ ] **Step 6: Rewrite the "Request body escaping" section (limitation now resolved)**

In the Security model area, replace:
```markdown
### Request body escaping

`{{value}}` is substituted into the POST body as raw text, **not** JSON-escaped. A typed value containing `"` or `\` will produce a malformed body and the upstream call will fail. Prefer `GET` with `{{value}}` in the URL (where it *is* encoded), or add a Trigger Regex that restricts input to safe characters before the lookup fires.
```
with:
```markdown
### Request body escaping

Embed the typed value in a JSON body with the Liquid `json` filter: `{{ value | json }}` outputs a properly quoted, escaped JSON string, so a value containing `"` or `\` still produces a valid body. Inserting `{{ value }}` raw into JSON is possible but unsafe for that reason — prefer `{{ value | json }}`.
```

Also update the trusted-configuration note (a few lines above), replacing `template `{{env.VAR}}` into it` with `template `{{ env.VAR }}` into it`.

- [ ] **Step 7: Sanity-check the README renders**

Run:
```bash
grep -n "{{ value\|{{ env\|url_encode\|| json" README.md
```
Expected: matches show the updated `{{ value … }}` / `{{ env.VAR }}` forms and no remaining bare `{{value}}`/`{{env.VAR}}`. Confirm no stray un-escaped `|` broke a table cell by eyeballing the three edited table rows.

- [ ] **Step 8: Commit**

```bash
git add src/api-autofill-input/index.ts README.md
git commit -m "docs: document Liquid templating in option notes and README"
```

---

### Task 4: Response-side field-mapping templating

**Files:**
- Modify: `src/utils/liquid.ts` (add `lenientEngine`, `renderTemplateSync`, `isTemplate`)
- Test: `src/utils/liquid.test.ts` (add helper tests)
- Modify: `src/utils/apply-mappings.ts` (branch on `isTemplate`)
- Test: `src/utils/apply-mappings.test.ts` (add template cases)
- Modify: `src/api-autofill-input/index.ts` (Field Mappings note)
- Modify: `README.md` (Field Mappings templating note)

**Interfaces:**
- Consumes (from Task 1): the `Liquid` import already at the top of `liquid.ts`; `getByPath` (existing, from `json-path.js`).
- Produces:
  - `function isTemplate(src: string): boolean`
  - `function renderTemplateSync(src: string, scope: object): string`
  - `resolveMappings(data: unknown, mappings: Mapping[]): FieldUpdate[]` — signature unchanged (stays synchronous).

- [ ] **Step 1: Add failing tests for the response-side helpers**

In `src/utils/liquid.test.ts`, change the import line:
```ts
import { renderTemplate, TemplateError } from './liquid.js';
```
to:
```ts
import { renderTemplate, renderTemplateSync, isTemplate, TemplateError } from './liquid.js';
```

Then append these two blocks at the end of the file (after the existing `describe('renderTemplate', …)` block's closing `});`):
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run src/utils/liquid.test.ts
```
Expected: FAIL — `renderTemplateSync` and `isTemplate` are not exported yet.

- [ ] **Step 3: Add the helpers to `src/utils/liquid.ts`**

Append to the end of `src/utils/liquid.ts` (the `Liquid` class is already imported at the top):
```ts
const lenientEngine = new Liquid({ strictVariables: false });

export function isTemplate(src: string): boolean {
  return /\{\{|\{%/.test(src);
}

export function renderTemplateSync(src: string, scope: object): string {
  return lenientEngine.parseAndRenderSync(src, scope);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/utils/liquid.test.ts
```
Expected: PASS — all 11 tests (7 from Task 1 + 4 new) green.

- [ ] **Step 5: Add failing tests for templated mappings**

In `src/utils/apply-mappings.test.ts`, insert these `it` blocks immediately before the closing `});` of the existing `describe('resolveMappings', …)` block:
```ts
  it('renders a Liquid-template source with a filter', () => {
    expect(
      resolveMappings({ name: 'john' }, [{ field_source: '{{ name | upcase }}', field_target: 'x' }]),
    ).toEqual([{ field: 'x', value: 'JOHN' }]);
  });

  it('joins two response fields in one template', () => {
    expect(
      resolveMappings({ first: 'Ada', last: 'Lovelace' }, [
        { field_source: '{{ first }} {{ last }}', field_target: 'full' },
      ]),
    ).toEqual([{ field: 'full', value: 'Ada Lovelace' }]);
  });

  it('keeps a partially-rendered template', () => {
    expect(
      resolveMappings({ first: 'Ada' }, [{ field_source: '{{ first }} {{ last }}', field_target: 'x' }]),
    ).toEqual([{ field: 'x', value: 'Ada ' }]);
  });

  it('skips a template that renders empty (all vars missing)', () => {
    expect(resolveMappings({}, [{ field_source: '{{ nope }}', field_target: 'x' }])).toEqual([]);
  });

  it('skips a malformed template without throwing', () => {
    expect(resolveMappings({ a: 'x' }, [{ field_source: '{{ a', field_target: 'x' }])).toEqual([]);
  });

  it('handles raw paths and templates together', () => {
    const data = { name: 'john', city: 'NY' };
    const mappings = [
      { field_source: 'name', field_target: 'name' },
      { field_source: '{{ city | upcase }}', field_target: 'city_uc' },
    ];
    expect(resolveMappings(data, mappings)).toEqual([
      { field: 'name', value: 'john' },
      { field: 'city_uc', value: 'NY' },
    ]);
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run:
```bash
npx vitest run src/utils/apply-mappings.test.ts
```
Expected: FAIL — the current `resolveMappings` treats `{{ name | upcase }}` as a dot-path, `getByPath` returns `undefined`, and those rows are skipped, so the new assertions fail.

- [ ] **Step 7: Implement the template branch in `src/utils/apply-mappings.ts`**

Replace the entire contents of `src/utils/apply-mappings.ts`:
```ts
import { getByPath } from './json-path.js';
import { isTemplate, renderTemplateSync } from './liquid.js';

export interface Mapping {
  field_source: string;
  field_target: string;
}

export interface FieldUpdate {
  field: string;
  value: unknown;
}

export function resolveMappings(data: unknown, mappings: Mapping[]): FieldUpdate[] {
  const updates: FieldUpdate[] = [];
  const scope = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  for (const mapping of mappings ?? []) {
    if (!mapping?.field_target || !mapping?.field_source) continue;

    if (isTemplate(mapping.field_source)) {
      let rendered: string;
      try {
        rendered = renderTemplateSync(mapping.field_source, scope);
      } catch {
        // Malformed template: skip only this mapping, never break the autofill.
        continue;
      }
      if (rendered === '') continue;
      updates.push({ field: mapping.field_target, value: rendered });
      continue;
    }

    const value = getByPath(data, mapping.field_source);
    if (value === null || value === undefined) continue;
    updates.push({ field: mapping.field_target, value });
  }

  return updates;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run:
```bash
npx vitest run src/utils/apply-mappings.test.ts
```
Expected: PASS — the 5 original tests plus the 6 new tests are green.

- [ ] **Step 9: Update the Field Mappings docs (option note + README)**

In `src/api-autofill-input/index.ts`, replace the Field Mappings note:
```ts
        note: 'Map a path in the API response (source) to a field in this collection (target).',
```
with:
```ts
        note: 'Map a path in the API response (source) to a field in this collection (target). Source may also be a Liquid template, e.g. {{ first_name }} {{ last_name }}.',
```

In `README.md`, replace the Field Mappings paragraph:
```markdown
**Field Mappings** is where the response becomes form data. Source paths are read with dot notation from the root of the JSON response, and array indexes work too (`results.0.name`). A mapping whose source path is missing from the response is skipped, leaving that field untouched.
```
with:
```markdown
**Field Mappings** is where the response becomes form data. Source paths are read with dot notation from the root of the JSON response, and array indexes work too (`results.0.name`). A mapping whose source path is missing from the response is skipped, leaving that field untouched.

A source containing `{{ … }}` is instead rendered as a [Liquid](https://liquidjs.com) template against the response — combine or reformat fields with filters, e.g. `{{ first_name }} {{ last_name }}` or `{{ price | times: 1.1 }}`. Missing fields render empty (the row is skipped if the whole result is empty), and a templated source always produces text, whereas a plain dot-path keeps the response value's native type.
```

- [ ] **Step 10: Run the full suite and build, then commit**

Run:
```bash
npm run test && npm run build
```
Expected: all Vitest tests pass; `directus-extension build` completes without errors (this confirms `dist/app.js` bundles LiquidJS cleanly).

```bash
git add -A
git commit -m "feat: support Liquid templates in field-mapping sources"
```

---

## Self-Review

**1. Spec coverage:**
- New `liquid.ts` module (engine + `renderTemplate` + `TemplateError`) → Task 1. ✓
- Delete `template.ts`/`template.test.ts`, replace `MissingEnvError` with `TemplateError` → Task 2 Steps 5–6. ✓
- `request-builder.ts` async, Liquid across URL/headers/body, Content-Type unchanged → Task 2 Steps 3. ✓
- Endpoint awaits + maps `TemplateError` → `NOT_CONFIGURED` → Task 2 Step 5. ✓
- Option notes / URL placeholder → Task 3 Step 1. ✓
- `strictVariables` strict undefined + nested-env verification → Task 1 Steps 2/5 (Global Constraints). ✓
- URL no-implicit-encode + `url_encode` migration → Task 2 tests + README Task 3 Steps 3/5. ✓
- `json` filter closes the documented body limitation → Task 3 Step 6. ✓
- `liquidjs ^10.27.2` dependency → Task 1 Step 1. ✓
- Tests: `liquid.test.ts` (filters, scope, strict) + rewritten `request-builder.test.ts` → Tasks 1–2. ✓
- README updates (request side) → Task 3. ✓
- Response-side opt-in templating (`isTemplate` detection, lenient sync render, skip-on-empty, skip malformed, type note) → Task 4. ✓
- Response engine is lenient/synchronous (`strictVariables: false`, `parseAndRenderSync`); `interface.vue` untouched → Task 4 Step 3/7. ✓
- Field Mappings note + README note → Task 4 Step 9. ✓
- App bundle now carries LiquidJS (`dist/app.js` build check) → Task 4 Step 10. ✓
- Out of scope (custom filters, exposing `value` to response templates) → untouched; no task, correct. ✓

**2. Placeholder scan:** No TBD/TODO. Every code and doc step shows exact content. ✓

**3. Type consistency:** `renderTemplate(src, scope)`, `TemplateScope { value, env }`, `EnvRecord`, and `TemplateError { variableName? }` are defined in Task 1 and consumed with identical names/signatures in Task 2 (`request-builder.ts` and the endpoint). `buildRequest` is `async … Promise<BuiltRequest>` in both its definition (Task 2 Step 3) and its call site (Task 2 Step 5, awaited). `isTemplate(src)` and `renderTemplateSync(src, scope)` are added to `liquid.ts` in Task 4 Step 3 and consumed with matching signatures in `apply-mappings.ts` (Task 4 Step 7); `resolveMappings` keeps its synchronous `(data, mappings) => FieldUpdate[]` signature, so its `interface.vue` call site is unaffected. ✓
