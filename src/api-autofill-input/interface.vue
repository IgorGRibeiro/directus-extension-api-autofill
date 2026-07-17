<template>
  <div class="api-autofill">
    <v-input
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

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { shouldSearch } from '../utils/trigger.js';
import { resolveMappings, type Mapping } from '../utils/apply-mappings.js';
import { useTranslation } from '../utils/use-translation.js';

const props = withDefaults(
  defineProps<{
    value?: string | null;
    collection: string;
    field: string;
    disabled?: boolean;
    debounceMs?: number;
    triggerRegex?: string;
    mappings?: Mapping[];
  }>(),
  {
    value: null,
    disabled: false,
    debounceMs: 500,
    triggerRegex: '',
    mappings: () => [],
  },
);

const emit = defineEmits<{
  (e: 'input', value: string | null): void;
  (e: 'setFieldValue', payload: { field: string; value: unknown }): void;
}>();

const { t } = useTranslation();
const api = useApi();

const isSearching = ref(false);
const errorMessage = ref<string | null>(null);
const lastSearched = ref<string | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInput(next: string | null): void {
  emit('input', next);
  if (debounceTimer) clearTimeout(debounceTimer);
  const value = next ?? '';
  debounceTimer = setTimeout(() => {
    if (!shouldSearch(value, lastSearched.value, props.triggerRegex || undefined)) return;
    void runSearch(value);
  }, props.debounceMs ?? 500);
}

async function runSearch(value: string): Promise<void> {
  isSearching.value = true;
  errorMessage.value = null;
  try {
    const response = await api.post('/api-autofill/search', {
      collection: props.collection,
      field: props.field,
      value,
    });
    lastSearched.value = value;
    const updates = resolveMappings(response.data?.data, props.mappings ?? []);
    for (const update of updates) {
      emit('setFieldValue', update);
    }
  } catch {
    errorMessage.value = t('search_error');
  } finally {
    isSearching.value = false;
  }
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<style scoped>
.api-autofill {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.api-autofill__notice {
  margin-top: 4px;
}
</style>
