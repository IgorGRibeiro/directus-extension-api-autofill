# Built-in input mask for the API Autofill interface

**Date:** 2026-07-24
**Extension:** `@ribertec/directus-extension-api-autofill`
**Status:** Approved design — ready for implementation plan

## Motivation

The API Autofill interface (`api-autofill-input`) is used to type identifiers that
drive an upstream lookup — CPF, CNPJ, CEP, phone numbers. These all have a fixed
visual format (`000.000.000-00`, `00.000.000/0000-00`, `00000-000`,
`(00) 00000-0000`). Today the interface is a plain controlled `v-input`: the user
types raw digits with no formatting guidance, and there is no way to store the value
in a canonical shape.

The user asked whether to support alternate *display* types (e.g. reusing the
separate masked-interface extension) or to embed masking directly. Embedding is the
right call: masking is an **interface** concern (it shapes input as the user types),
displays are read-only renderers and are selected independently of the interface, so
a display cannot mask entry. This design adds an **optional built-in mask** to the
existing interface, reusing the proven Inputmask technique from
`directus-extension-masked-interface` while keeping the API Autofill extension MIT
and its `v-input` shell intact.

## Decisions (settled)

1. **Mask config — generic template only.** Two option fields: a **Mask type**
   dropdown (`Template` / `RegEx`) and a **Mask pattern** text field. No built-in
   presets (no CPF/CNPJ/CEP shortcuts baked in) — the configurator writes the
   Inputmask pattern directly. Keeps the option surface small and avoids shipping a
   preset registry that would need maintenance.
2. **Lookup fires only when the mask is complete.** The debounced upstream lookup
   runs on the **raw unmasked digits** and only once Inputmask reports the value
   complete. The existing **Trigger Regex** still applies, tested against the raw
   value. This prevents half-typed documents from firing partial lookups.
3. **Option scope — lean + feedback.** Ship the essentials (Mask type, Mask pattern,
   Store masked value) plus a mask-syntax help note and invalid/incomplete visual
   feedback (red input text). Explicitly **out**: casing transform, font selector,
   left/right icons, placeholder option — none are needed for the document-entry use
   case and each adds option-panel noise.
4. **Store masked or raw — configurator's choice.** A **Store masked value** boolean
   (default **off** = store the raw unmasked digits). When on, the formatted value
   (with separators) is persisted. Storing raw is the sensible default for
   identifiers used as lookup keys.
5. **`v-input` is always the shell.** The mask attaches to the native `<input>`
   *inside* `v-input`, never to a bare `<input>` element. (User constraint: raw input
   elements "break easy on Directus layout".)
6. **License stays MIT.** `directus-extension-masked-interface` is GPL-3.0-or-later;
   its source is **not** copied. This design reuses only the public Inputmask library
   (MIT) and the general attach-to-inner-input technique, with original code and no
   GPL headers.

## Architecture

### Two modes, one interface — `v-input` is always the shell

`maskEnabled` is derived: **true when the configured Mask pattern is non-empty.**

- **No-mask mode (`maskEnabled === false`):** the current controlled `v-input` —
  `:model-value="value"` bound, `@update:model-value` → `onInput`. Byte-for-byte the
  existing behavior. This is the default and the full backward-compatibility path.
- **Mask mode (`maskEnabled === true`):** the `v-input` renders as a styled shell
  **without** `:model-value`; Inputmask owns the inner native `<input>`. The value is
  driven through the Inputmask instance, not through Vue's `model-value`.

The template is two `v-input` branches selected by `v-if="maskEnabled"` inside a
container `<div ref="containerRef">`. The mask branch omits `:model-value`; the
no-mask branch is the current binding. This keeps the two value-flow models cleanly
separated rather than conditionally binding one element.

### New composable: `src/utils/use-mask.ts`

Encapsulates the entire Inputmask lifecycle so `interface.vue` stays declarative and
the DOM wiring is isolated and independently reasoned about:

- **Attach** (`onMounted`): resolve the inner input via
  `containerRef.value?.querySelector('input')`, construct `Inputmask(aliasOrNull,
  { [maskType]: pattern, autoUnmask: false, ... }).mask(nativeInput)`, then seed the
  current `props.value`.
- **Survive re-render:** `watch(() => props.value, ...)` with `await nextTick()`
  before `setValue`, because a `v-input` re-render otherwise clobbers the value
  Inputmask set (the documented nextTick dance).
- **Teardown** (`onBeforeUnmount`, matching the existing file's convention):
  `instance.remove()` alongside the existing debounce-timer cleanup.
- **Surface state to the caller:** exposes `{ raw, complete, invalid }`.
  - `raw` — `instance.unmaskedvalue()` (digits only).
  - `complete` — `instance.isComplete()`.
  - `invalid` — a `ref`: `true` when the input is non-empty **and** not complete.
    Drives the red-text feedback via a container class.
- **Emit hook:** on each native `input` event the composable invokes a caller-supplied
  callback with the current `{ raw, complete }` so `interface.vue` owns the
  storage/emit and search-gating policy (below).

### New helper: `resolveStoredValue` (in `src/utils/`, pure & unit-tested)

```ts
export function resolveStoredValue(
  raw: string,
  formatted: string,
  storeMasked: boolean,
): string | null;
```

Returns `null` for an empty raw value, otherwise `formatted` when `storeMasked` is
true, else `raw`. Pure and fully unit-testable — it carries the store-masked/raw
decision out of the DOM-bound composable so the branching logic is tested without a
browser.

### Changed: `src/api-autofill-input/interface.vue`

- Template gains the container `<div ref="containerRef">` and the two `v-input`
  branches (`v-if="maskEnabled"`). The container carries an `invalid` class binding
  for the red-text feedback; the existing `v-notice` error path is unchanged.
- `maskEnabled` computed from the new `maskPattern` prop.
- When `maskEnabled`, wire `use-mask`, passing `containerRef`, the mask config, and an
  on-change callback. The callback:
  - **Storage:** emit `input` with `resolveStoredValue(raw, formatted, storeMasked)`
    on every change (matching the current "emit as you type" behavior).
  - **Lookup gating:** run the debounced search **only when `complete === true`**,
    then apply the existing `shouldSearch(raw, ...)` (Trigger Regex on the raw value),
    then `runSearch(raw)`. Half-complete input never triggers a lookup.
- **No-mask mode is unchanged:** `onInput`, debounce, `shouldSearch`, `runSearch`,
  `resolveMappings`, and the `setFieldValue` emit flow all stay as they are. In this
  mode the value is always treated as "complete" (there is no mask to be incomplete).
- Response-side handling (`resolveMappings`, Liquid templating, `setFieldValue` with
  `await nextTick()` between updates) is **untouched** — masking only changes how the
  *input* value is captured and how the *search* is gated.

### Changed: `src/api-autofill-input/index.ts` (option schema)

Three new options plus one help note, placed **after Trigger Regex**, using the
English literal labels already used throughout this file:

| Field | Interface | Notes |
| --- | --- | --- |
| `maskType` | `select-dropdown` (`Template` / `RegEx`) | default `Template` |
| `maskPattern` | `input` (monospace) | empty = masking off |
| `storeMasked` | `boolean` | default `false` (store raw) |
| *(help note)* | `presentation-notice` | Inputmask syntax legend; shown when `maskType === 'mask'` (Template) via a `conditions` rule |

The legend text mirrors Inputmask's documented tokens (original wording):
`9` number, `a` lower char, `A` upper char, `*` alphanumeric, `\` escape, `|`
alternator, `[]` optional, `()` grouping, `{n,[m]}` repeater.

The new props are added to `interface.vue`'s `defineProps` with safe defaults
(`maskType: 'mask'`, `maskPattern: ''`, `storeMasked: false`).

## Data flow

**No-mask mode** (unchanged):

```
user types → onInput(next) → emit('input', next) + debounce
  → shouldSearch(next) → runSearch(next) → resolveMappings → setFieldValue(...)
```

**Mask mode:**

```
user types in masked input
  → use-mask onChange({ raw, complete })
      → emit('input', resolveStoredValue(raw, formatted, storeMasked))   [every change]
      → if complete: debounce → shouldSearch(raw) → runSearch(raw)
            → resolveMappings → setFieldValue(...)                       [complete only]
  props.value change → watch + nextTick → instance.setValue(...)         [survives re-render]
```

## Error / feedback handling

| Condition | Behavior |
| --- | --- |
| Value non-empty but incomplete | `invalid = true` → input text turns red; no lookup fires |
| Value complete | `invalid = false`; lookup gated by Trigger Regex, then fires on raw |
| Value cleared | `invalid = false`; emit `null` |
| Upstream lookup error | unchanged — existing `errorMessage` / `v-notice` path |

No new user-facing i18n strings are introduced — the feedback is purely visual (red
text), consistent with the reference implementation.

## Dependency / bundle

Add `inputmask` (`^5.x`, MIT) to `dependencies` in `package.json`. It is client-side
only and lands in the app bundle (`dist/app.js`). Add `@types/inputmask` as a
devDependency **only if** the TypeScript build requires it — verify during
implementation (Inputmask ships its own types in recent 5.x; confirm before adding).

## Backward compatibility

- **No Mask pattern configured ⇒ no Inputmask, controlled `v-input`, identical
  behavior.** Existing configured fields see no change — the mask options default to
  off and the no-mask branch is the current code path.
- Liquid request/response templating and all endpoint logic are untouched.
- No stored-data migration: existing values continue to load; enabling a mask later
  only affects presentation and (if Store masked is turned on) newly typed values.

## Testing (Vitest, TDD)

**Unit — `src/utils/resolveStoredValue.test.ts` (new):**

- empty raw → `null` regardless of `storeMasked`
- `storeMasked === false` → returns `raw`
- `storeMasked === true` → returns `formatted`

The Inputmask DOM lifecycle (attach, nextTick re-render survival, complete/invalid
transitions) is **not** unit-tested — it requires a live DOM and Directus's
`v-input`. It is validated by `npm run build` + `npm run validate` and a manual smoke
test in a running Directus instance (mask a CPF field: incomplete → red, complete →
lookup fires, store masked vs. raw both persist correctly).

## Out of scope

- **Built-in format presets** (CPF/CNPJ/CEP shortcuts). The generic Template/RegEx
  pattern covers them; a preset dropdown can be added later without changing this
  design.
- **Casing transform, font selector, icons, placeholder option.** Deliberately
  dropped (Decision 3).
- **Masking the response-filled sibling fields.** Masking applies only to this
  interface's own input; sibling fields are filled via `setFieldValue` and formatted
  by their own interfaces.
