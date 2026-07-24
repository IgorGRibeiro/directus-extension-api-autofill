# Built-in Input Mask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, configurable input mask (CPF/CNPJ/CEP/phone formats) to the API Autofill interface, gating the upstream lookup on mask completion.

**Architecture:** The interface keeps `v-input` as the shell in both modes. When a Mask pattern is configured, the `inputmask` library attaches to the native `<input>` inside `v-input` (via a container ref + `querySelector`), driven by a `use-mask` composable that isolates the DOM lifecycle. A pure `resolveStoredValue` helper decides raw-vs-formatted storage. With no Mask pattern, the existing controlled `v-input` path runs unchanged.

**Tech Stack:** Directus 11 bundle extension, Vue 3 `<script setup lang="ts">`, `inputmask` ^5.x (MIT), Vitest 4.

## Global Constraints

- **License stays MIT.** Do **not** copy source from `directus-extension-masked-interface` (GPL-3.0-or-later). Reuse only the public `inputmask` library and the general technique; write original code with no GPL headers.
- **`v-input` is always the shell.** Never render a bare `<input>`; the mask attaches to the native input *inside* `v-input`.
- **English labels/notes** in `index.ts` option definitions (match the existing file).
- **Backward compatible:** empty Mask pattern ⇒ no Inputmask, current controlled `v-input`, identical behavior. All new options default to off.
- **Dependency:** `inputmask` `^5.x`, added to `dependencies` (client-side, lands in `dist/app.js`).
- **Host:** Directus `^11.0.0`.
- Spec: `docs/superpowers/specs/2026-07-24-masked-input-design.md`.

---

### Task 1: Pure `resolveStoredValue` helper

Decides whether the stored value is the raw unmasked string or the formatted (masked) string. Pure and fully unit-tested — carries the store-masked/raw branch out of the DOM-bound composable.

**Files:**
- Create: `src/utils/resolve-stored-value.ts`
- Test: `src/utils/resolve-stored-value.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveStoredValue(raw: string, formatted: string, storeMasked: boolean): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/utils/resolve-stored-value.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveStoredValue } from './resolve-stored-value.js';

describe('resolveStoredValue', () => {
  it('returns null for an empty raw value regardless of storeMasked', () => {
    expect(resolveStoredValue('', '', false)).toBe(null);
    expect(resolveStoredValue('', '___.___.___-__', true)).toBe(null);
  });

  it('returns the raw value when storeMasked is false', () => {
    expect(resolveStoredValue('12345678901', '123.456.789-01', false)).toBe('12345678901');
  });

  it('returns the formatted value when storeMasked is true', () => {
    expect(resolveStoredValue('12345678901', '123.456.789-01', true)).toBe('123.456.789-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resolve-stored-value`
Expected: FAIL — `Cannot find module './resolve-stored-value.js'` (or `resolveStoredValue is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/resolve-stored-value.ts`:

```ts
/**
 * Decide which form of a masked input's value to persist.
 *
 * @param raw        the unmasked characters (Inputmask `unmaskedvalue()`)
 * @param formatted  the masked display string (the native input's value)
 * @param storeMasked when true, persist `formatted`; otherwise persist `raw`
 * @returns the value to store, or `null` when there is nothing typed
 */
export function resolveStoredValue(
  raw: string,
  formatted: string,
  storeMasked: boolean,
): string | null {
  if (!raw) return null;
  return storeMasked ? formatted : raw;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resolve-stored-value`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/resolve-stored-value.ts src/utils/resolve-stored-value.test.ts
git commit -m "feat: add resolveStoredValue helper for masked input storage"
```

---

### Task 2: `inputmask` dependency + `use-mask` composable

Add the library and encapsulate the entire Inputmask DOM lifecycle in a composable. The DOM lifecycle is **not** unit-tested (it needs a live DOM + Directus `v-input`); this task's gate is that the file compiles and the build succeeds. Behavior is validated manually in Task 4.

**Files:**
- Modify: `package.json` (add `inputmask` to `dependencies`)
- Create: `src/utils/use-mask.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses Vue + `inputmask`).
- Produces:
  - `interface MaskChange { raw: string; formatted: string; complete: boolean }`
  - `interface UseMaskOptions { containerRef: Ref<HTMLElement | null>; maskType: 'mask' | 'regex'; pattern: string; getValue: () => string | null; onChange: (change: MaskChange) => void }`
  - `useMask(options: UseMaskOptions): { invalid: Ref<boolean> }`

- [ ] **Step 1: Add the dependency**

Run:

```bash
npm install inputmask@^5
```

Expected: `inputmask` appears under `dependencies` in `package.json` and `node_modules/inputmask` exists. Inputmask 5.x ships its own type declarations — do **not** add `@types/inputmask` unless Step 4's build reports missing types.

- [ ] **Step 2: Verify install**

Run: `node -e "console.log(require('inputmask/package.json').version)"`
Expected: prints a `5.x` version string.

- [ ] **Step 3: Write the composable**

Create `src/utils/use-mask.ts`:

```ts
import { ref, onMounted, onBeforeUnmount, watch, nextTick, type Ref } from 'vue';
import Inputmask from 'inputmask';

export interface MaskChange {
  /** Unmasked characters only (Inputmask `unmaskedvalue()`). */
  raw: string;
  /** Masked display string (the native input's current value). */
  formatted: string;
  /** True when Inputmask reports the value complete. */
  complete: boolean;
}

export interface UseMaskOptions {
  /** Ref to the element wrapping the `v-input`; its inner `<input>` is masked. */
  containerRef: Ref<HTMLElement | null>;
  /** Interpret `pattern` as an Inputmask template (`mask`) or a regex. */
  maskType: 'mask' | 'regex';
  /** The mask pattern. When empty, the composable does nothing (no-mask mode). */
  pattern: string;
  /** Reads the current bound value (typically `() => props.value`). */
  getValue: () => string | null;
  /** Invoked on every native input event with the current mask state. */
  onChange: (change: MaskChange) => void;
}

/**
 * Attaches Inputmask to the native `<input>` inside a `v-input` shell and
 * surfaces an `invalid` flag (non-empty but incomplete). No-ops when `pattern`
 * is empty so the caller's controlled `v-input` path is left untouched.
 */
export function useMask(options: UseMaskOptions): { invalid: Ref<boolean> } {
  const invalid = ref(false);
  let instance: ReturnType<Inputmask.Instance['mask']> | null = null;
  let nativeInput: HTMLInputElement | null = null;

  function updateInvalid(): void {
    if (!instance || !nativeInput) {
      invalid.value = false;
      return;
    }
    const hasValue = nativeInput.value.trim().length > 0;
    invalid.value = hasValue && !instance.isComplete();
  }

  function handleInput(): void {
    if (!instance || !nativeInput) return;
    updateInvalid();
    options.onChange({
      raw: instance.unmaskedvalue(),
      formatted: nativeInput.value,
      complete: instance.isComplete(),
    });
  }

  onMounted(() => {
    if (!options.pattern.trim()) return; // no-mask mode: leave v-input controlled
    nativeInput = options.containerRef.value?.querySelector('input') ?? null;
    if (!nativeInput) return;

    instance = Inputmask({
      [options.maskType]: options.pattern,
      autoUnmask: false,
      clearIncomplete: false,
      showMaskOnHover: false,
      showMaskOnFocus: true,
      nullable: true,
    }).mask(nativeInput);

    instance.setValue(options.getValue() ?? '');
    updateInvalid();
    nativeInput.addEventListener('input', handleInput);
  });

  onBeforeUnmount(() => {
    nativeInput?.removeEventListener('input', handleInput);
    instance?.remove();
  });

  watch(
    () => options.getValue(),
    async (newValue) => {
      if (!instance) return;
      const incoming = newValue ?? '';
      // Skip when the incoming value already matches what's displayed. This
      // avoids reformatting mid-type (cursor jumps) when our own emitted value
      // flows back through props.
      if (incoming === instance.unmaskedvalue() || incoming === nativeInput?.value) return;
      // Wait for Vue to finish re-rendering the v-input before setting the
      // masked value, otherwise the re-render overwrites what Inputmask set.
      await nextTick();
      instance.setValue(incoming);
      updateInvalid();
    },
  );

  return { invalid };
}
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds and emits `dist/app.js`. If it fails with a missing-types error for `inputmask`, run `npm install -D @types/inputmask` and rebuild. If it fails because `Inputmask.Instance` is not a usable type, replace the `instance` declaration with `let instance: any = null;` and rebuild (Inputmask's exported types vary across 5.x patch releases; `any` on the single instance handle is acceptable here since the DOM behavior is manually verified).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/utils/use-mask.ts
git commit -m "feat: add inputmask dependency and use-mask composable"
```

---

### Task 3: Wire masking into `interface.vue`

Add the container ref, the two `v-input` branches, the new props, and the mask-mode value/search flow. No-mask mode stays byte-for-byte the current behavior.

**Files:**
- Modify: `src/api-autofill-input/interface.vue`

**Interfaces:**
- Consumes: `resolveStoredValue` (Task 1), `useMask` + `MaskChange` (Task 2).
- Produces: rendered behavior only (no exported symbols).

- [ ] **Step 1: Replace the template**

In `src/api-autofill-input/interface.vue`, replace the `<template>` block with:

```vue
<template>
  <div
    ref="containerRef"
    class="api-autofill"
    :class="{ 'api-autofill--invalid': maskEnabled && invalid }"
  >
    <v-input
      v-if="maskEnabled"
      :disabled="disabled"
      :loading="isSearching"
    />
    <v-input
      v-else
      :model-value="value"
      :disabled="disabled"
      :loading="isSearching"
      @update:model-value="onInput"
    />
    <v-notice v-if="errorMessage" type="warning" class="api-autofill__notice">
      {{ errorMessage }}
    </v-notice>
  </div>
</template>
```

- [ ] **Step 2: Update imports and props**

Replace the import line

```ts
import { ref, onBeforeUnmount, nextTick } from 'vue';
```

with

```ts
import { ref, computed, onBeforeUnmount, nextTick } from 'vue';
import { useMask, type MaskChange } from '../utils/use-mask.js';
import { resolveStoredValue } from '../utils/resolve-stored-value.js';
```

Then add the three new props to the `defineProps` object (inside the type literal, after `mappings?: Mapping[];`):

```ts
    maskType?: 'mask' | 'regex';
    maskPattern?: string;
    storeMasked?: boolean;
```

and to the `withDefaults` defaults object (after `mappings: () => [],`):

```ts
    maskType: 'mask',
    maskPattern: '',
    storeMasked: false,
```

- [ ] **Step 3: Add mask wiring**

Immediately after the existing `let debounceTimer: ReturnType<typeof setTimeout> | null = null;` line, add:

```ts
const containerRef = ref<HTMLElement | null>(null);
const maskEnabled = computed(() => !!props.maskPattern && props.maskPattern.trim().length > 0);

function onMaskChange({ raw, formatted, complete }: MaskChange): void {
  emit('input', resolveStoredValue(raw, formatted, props.storeMasked));
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!complete) return; // never look up a half-typed value
  debounceTimer = setTimeout(() => {
    if (!shouldSearch(raw, lastSearched.value, props.triggerRegex || undefined)) return;
    void runSearch(raw);
  }, props.debounceMs ?? 500);
}

const { invalid } = useMask({
  containerRef,
  maskType: props.maskType,
  pattern: props.maskPattern,
  getValue: () => props.value,
  onChange: onMaskChange,
});
```

(Leave `onInput`, `runSearch`, and the `onBeforeUnmount` debounce cleanup exactly as they are — they serve no-mask mode and are shared with mask mode via `debounceTimer`/`runSearch`.)

- [ ] **Step 4: Add the invalid style**

In the `<style scoped>` block, after the `.api-autofill__notice` rule, add:

```css
.api-autofill--invalid :deep(.v-input input) {
  color: var(--danger);
}
```

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds, emits `dist/app.js`.

- [ ] **Step 6: Commit**

```bash
git add src/api-autofill-input/interface.vue
git commit -m "feat: mask the autofill input and gate lookup on mask completion"
```

---

### Task 4: Mask options in `index.ts` + verification

Expose the mask configuration in the collection editor and verify the whole feature builds, validates, and behaves.

**Files:**
- Modify: `src/api-autofill-input/index.ts`

**Interfaces:**
- Consumes: the props declared in Task 3 (`maskType`, `maskPattern`, `storeMasked`).
- Produces: option definitions only.

- [ ] **Step 1: Add the option definitions**

In `src/api-autofill-input/index.ts`, insert the following four option objects **between** the `triggerRegex` option and the `mappings` option (after the `triggerRegex` object's closing `},` and before `{ field: 'mappings', ... }`):

```ts
    {
      field: 'maskType',
      name: 'Mask type',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'select-dropdown',
        note: 'How the Mask pattern is interpreted.',
        options: {
          choices: [
            { text: 'Template', value: 'mask' },
            { text: 'RegEx', value: 'regex' },
          ],
        },
      },
      schema: { default_value: 'mask' },
    },
    {
      field: 'maskPattern',
      name: 'Mask pattern',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Leave empty to disable masking. Template example (CPF): 999.999.999-99',
        options: { placeholder: '999.999.999-99', font: 'monospace' },
      },
    },
    {
      field: 'storeMasked',
      name: 'Store masked value',
      type: 'boolean',
      meta: {
        width: 'half',
        interface: 'boolean',
        note: 'On: store the formatted value with separators. Off: store raw characters only.',
        options: { label: 'Store the formatted value' },
      },
      schema: { default_value: false },
    },
    {
      field: 'maskHelp',
      name: 'Mask syntax',
      type: 'alias',
      meta: {
        width: 'full',
        interface: 'presentation-notice',
        options: {
          icon: 'help',
          text: 'Template tokens: 9 = number, a = lower char, A = upper char, * = alphanumeric, \\ = escape, | = alternator, [] = optional, () = grouping, {n,[m]} = repeater.',
        },
        hidden: true,
        conditions: [
          { name: 'Shown for Template', rule: { maskType: { _eq: 'mask' } }, hidden: false },
        ],
      },
    },
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds, emits `dist/app.js` and `dist/api.js`.

- [ ] **Step 3: Validate**

Run: `npm run validate`
Expected: validation passes (built code, directus config, license, readme all OK).

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all tests pass, including the Task 1 `resolveStoredValue` tests. No new failures in existing suites.

- [ ] **Step 5: Manual smoke test (in a running Directus)**

Link and load the extension (`npm run link`, then reload Directus with the extension on a `string` field). Verify:
1. **No mask configured** → field behaves exactly as before (types freely, lookup fires per Trigger Regex/debounce).
2. **Mask pattern `999.999.999-99`, Store masked off** → input formats as you type; text is **red** while incomplete; when the 11th digit lands, red clears and the lookup fires once; the stored value is the raw 11 digits.
3. **Store masked on** → the stored value is the formatted `000.000.000-00` string.
4. **Reload an existing record** → the saved value re-displays correctly formatted in the masked input (the `nextTick` re-render survival works).
5. **RegEx mask type** with a simple pattern (e.g. `\d{1,8}`) → accepts matching input.

- [ ] **Step 6: Commit**

```bash
git add src/api-autofill-input/index.ts
git commit -m "feat: expose mask type, pattern and store-masked options"
```

---

## Self-review notes

- **Spec coverage:** two-mode architecture (Task 3), `use-mask` composable (Task 2), `resolveStoredValue` (Task 1), option schema + help note (Task 4), lookup-gated-on-complete (Task 3 `onMaskChange`), invalid red-text feedback (Tasks 2+3), `inputmask` dependency (Task 2), backward compat via empty-pattern no-op (Tasks 2+3), manual DOM validation (Task 4). All spec sections map to a task.
- **License:** no GPL source copied; only the `inputmask` library and technique reused (Global Constraints).
- **Type consistency:** `MaskChange`/`UseMaskOptions`/`useMask` signatures match between Task 2 (definition) and Task 3 (consumption); prop names `maskType`/`maskPattern`/`storeMasked` match between Task 3 (props) and Task 4 (option `field`s) so Directus binds them correctly.
