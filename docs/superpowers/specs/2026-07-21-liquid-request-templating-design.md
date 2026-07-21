# Liquid templating for request building

**Date:** 2026-07-21
**Extension:** `@ribertec/directus-extension-api-autofill`
**Status:** Approved design — ready for implementation plan

## Motivation

The API Autofill endpoint builds an outbound HTTP request (URL, headers, body) from
field-configured templates, substituting the user's typed `value` and server
environment variables. The current engine (`src/utils/template.ts`) does two fixed
operations only:

- `{{value}}` — inserted raw, except in the URL where it is `encodeURIComponent`-ed
- `{{env.VAR}}` — resolved from server env, throwing if unset

It cannot **transform** a value before sending it. Real cases require formatting:
upper/lcasing, trimming, zero-padding, date reformatting, and — most importantly —
**JSON-escaping a value for a POST body**. The README already documents this last
point as a hard limitation:

> `{{value}}` is substituted into the POST body as raw text, **not** JSON-escaped. A
> typed value containing `"` or `\` will produce a malformed body and the upstream
> call will fail.

This design replaces the fixed substitution engine with the
[LiquidJS](https://liquidjs.com) template engine so configurators can apply Liquid
filters (`upcase`, `date`, `url_encode`, `json`, …) across all three request
surfaces. LiquidJS's built-in `json` filter directly closes the documented body
limitation.

## Decisions (settled)

1. **Scope of Liquid:** all three surfaces — URL, headers, and body — rendered by a
   single unified engine. The prior fixed engine is removed entirely.
2. **URL encoding:** the URL no longer auto-encodes the value. Configurators write
   `{{ value | url_encode }}` explicitly. This is an accepted breaking change to
   existing URL templates (see Migration).
3. **Undefined variables:** strict. `strictVariables: true` — any undefined
   reference (missing env var, or a typo'd variable name) aborts the request and is
   surfaced to the user as `NOT_CONFIGURED`, naming the variable. This preserves the
   current "Server env var not set: X" diagnostic and additionally catches template
   typos.
4. **Placement:** server-side only (the endpoint already performs request building).
   No client/app-bundle impact — LiquidJS lands only in `dist/api.js`.

## Architecture

### New module: `src/utils/liquid.ts`

- A single shared `Liquid` engine instance, configured `{ strictVariables: true }`.
- One async helper:

  ```ts
  export type EnvRecord = Record<string, string | undefined>;

  export interface TemplateScope {
    value: string;
    env: EnvRecord;
  }

  export function renderTemplate(src: string, scope: TemplateScope): Promise<string>;
  ```

  Internally calls `engine.parseAndRender(src, scope)`. Async is acceptable — the
  endpoint handler is already async and this runs only on the server.

- `TemplateError` — a typed error thrown when rendering fails on an undefined
  variable. Carries the offending variable name:

  ```ts
  export class TemplateError extends Error {
    readonly variableName?: string;
    constructor(message: string, variableName?: string);
  }
  ```

  `renderTemplate` catches LiquidJS's undefined-variable error, extracts the
  variable name, and rethrows as `TemplateError`. Non-undefined render errors
  (e.g. malformed template syntax) also surface as `TemplateError` (without a
  `variableName`) so the endpoint can report them cleanly rather than 500-ing.

### Removed: `src/utils/template.ts` and `src/utils/template.test.ts`

`substituteValue`, `resolveEnv`, and `MissingEnvError` are deleted. LiquidJS
subsumes both substitution paths. `MissingEnvError` is replaced by the broader
`TemplateError` in `liquid.ts`.

### Changed: `src/utils/request-builder.ts`

`buildRequest` becomes async and renders every surface through `renderTemplate`
with scope `{ value, env }`:

```ts
export async function buildRequest(
  options: AutofillOptions,
  value: string,
  env: EnvRecord,
): Promise<BuiltRequest>;
```

- **URL:** `await renderTemplate(options.url, scope)` — no implicit encoding.
- **Headers:** each `value` rendered via `renderTemplate`; `{{ env.VAR }}` continues
  to work because `env` is in scope.
- **Body (POST only):** `await renderTemplate(options.body, scope)`.
- **Content-Type auto-set logic is unchanged** — `application/json` is added for a
  POST body when the configurator has not supplied a `Content-Type` header.

`AutofillOptions` and `BuiltRequest` interfaces are unchanged.

### Changed: `src/api-autofill/index.ts`

- `buildRequest(...)` is now awaited.
- The existing `catch` branch that maps `MissingEnvError` → `NOT_CONFIGURED` becomes
  `err instanceof TemplateError`, still returning HTTP 400 with
  `{ code: 'NOT_CONFIGURED', message: ... }`. The message includes the variable name
  when present (e.g. `Undefined variable: env.TOKEN`), otherwise the render error
  message.

### Changed: `src/api-autofill-input/index.ts` (option notes)

Update the `note` strings (English, matching existing code) so the collection editor
documents Liquid:

- **Request URL:** `Supports Liquid — e.g. {{ value | url_encode }} and {{ env.VAR }} (resolved on the server).`
- **Headers:** `Values support Liquid — e.g. Bearer {{ env.VAR }}.`
- **Request Body (JSON):** `POST only. Supports Liquid — use {{ value | json }} to safely JSON-encode the typed value.`

The placeholder for the URL option is updated to
`https://api.example.com/lookup?q={{ value | url_encode }}`.

## Data flow (unchanged except rendering)

```
user types → interface.vue debounce → POST /api-autofill/search { collection, field, value }
  → endpoint loads field options under caller accountability
  → buildRequest(options, value, env)                 ← now Liquid-rendered, async
      → renderTemplate(url,    { value, env })
      → renderTemplate(header, { value, env })  (per header)
      → renderTemplate(body,   { value, env })  (POST only)
  → fetch(upstream) → return raw JSON `data` to client
  → client resolveMappings(data, mappings)            ← UNCHANGED, out of scope
```

## Error handling

| Condition                          | Behavior                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| Undefined var (`{{ env.NOPE }}`)   | `TemplateError(variableName)` → HTTP 400 `NOT_CONFIGURED`      |
| Typo'd var (`{{ velue }}`)         | `TemplateError(variableName)` → HTTP 400 `NOT_CONFIGURED`      |
| Malformed template syntax          | `TemplateError` (no var name) → HTTP 400 `NOT_CONFIGURED`      |
| Upstream / timeout / non-JSON      | unchanged (existing 502 / 504 handling)                        |

The client already renders `NOT_CONFIGURED` via the `not_configured` i18n key; no new
user-facing strings are introduced.

## Backward compatibility & migration

- **Body & header templates:** `{{value}}` and `{{env.VAR}}` render identically under
  Liquid with scope `{ value, env }`. No change required.
- **URL templates — breaking:** any existing URL relying on implicit encoding of
  `{{value}}` must change to `{{ value | url_encode }}`. Callers that only interpolate
  already-safe values (e.g. an 8-digit CEP) continue to work without the filter, but
  adding it is recommended.

This is acceptable: the extension is at v1.0.0 and the change is documented in the
README migration/setup notes.

## Documentation updates (`README.md`)

Part of the deliverable — the README documents the current syntax in several places:

- Options table (URL / Headers / Body rows): describe Liquid, and change the body row
  to note `{{ value | json }}` produces valid JSON.
- Example configs using `?q={{value}}` → `?q={{ value | url_encode }}`.
- **Limitations section:** the "raw text, not JSON-escaped" body limitation is
  **resolved** — replace it with guidance to use `{{ value | json }}`. Keep the
  "configuration is trusted" security note (unchanged, still accurate).
- The env-secrets note (`{{env.VAR}}`) remains valid.

## Dependency

Add `liquidjs` (currently `^10.27.2`) to `dependencies` in `package.json`. It is a
pure-JS engine used only at runtime on the server.

## Testing (unit only, Vitest, TDD)

**New `src/utils/liquid.test.ts`:**

- renders a plain `{{ value }}` from scope
- applies filters: `upcase`, `url_encode` (e.g. `a b` → `a%20b`), and `json`
  (a value containing `"` produces a valid quoted JSON string)
- resolves `{{ env.VAR }}` from the `env` scope object
- strict mode: an undefined top-level variable throws `TemplateError` naming it
- strict mode: an undefined **env key** (`{{ env.NOPE }}`) throws `TemplateError`
  (see Verification point — the enforcement mechanism is confirmed here)

**Rewritten `src/utils/request-builder.test.ts` (now async):**

- GET URL with `{{ value | url_encode }}` encodes the value; a bare `{{ value }}`
  stays raw (documents the new no-implicit-encode behavior)
- POST body built with `{{ value | json }}` yields valid JSON for a value containing
  quotes; default `Content-Type: application/json` is applied
- a supplied `Content-Type` header is not overridden
- header `{{ env.VAR }}` resolves from env
- a missing env var referenced anywhere throws `TemplateError`

**Removed:** `src/utils/template.test.ts`.

## Verification point (resolve during implementation)

Confirm that `strictVariables: true` throws for a **missing key on the `env`
object** (`{{ env.NOPE }}` where `env` is defined but has no `NOPE`), not only for a
missing top-level variable. Establish this with the `liquid.test.ts` test above
*before* relying on it. If LiquidJS treats nested undefined access leniently under
`strictVariables`, enforce the `NOT_CONFIGURED` guarantee by wrapping `env` in a
throwing accessor (e.g. a `Proxy` whose `get` throws a `TemplateError` for an absent
key) before passing it into the render scope. The observable contract — missing env
var ⇒ `NOT_CONFIGURED` naming the variable — must hold regardless of which mechanism
enforces it.

## Out of scope

- **Response → target-field templating** (client-side `apply-mappings.ts`).
  Explicitly deferred; the user rated it low value. `resolveMappings` and its raw
  dot-path extraction are untouched.
- **Custom Liquid filters.** Built-in filters cover the current need. Registering
  domain-specific filters (e.g. CPF/CNPJ formatting) can be added later on the shared
  engine instance without changing this design.
