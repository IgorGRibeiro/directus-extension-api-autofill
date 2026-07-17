import { useI18n } from 'vue-i18n';
import { useStores } from '@directus/extensions-sdk';
import { resolveLocale } from './locale.js';
import { messages } from '../i18n/index.js';

export function useTranslation() {
  const { useSettingsStore } = useStores();
  const { settings } = useSettingsStore();

  return useI18n({
    locale: resolveLocale(settings?.default_language ?? ''),
    messages,
    fallbackLocale: 'en',
  });
}
