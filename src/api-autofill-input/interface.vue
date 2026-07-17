<template>
  <v-input :model-value="value" :disabled="disabled" @update:model-value="$emit('input', $event)" />
</template>

<script setup lang="ts">
defineProps<{
  value?: string | null;
  disabled?: boolean;
}>();
defineEmits<{ (e: 'input', value: string | null): void }>();
</script>
