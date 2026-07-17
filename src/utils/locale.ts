const FULL_LOCALE_EXCEPTIONS = new Set(['zh-CN', 'zh-TW', 'sr-SP', 'sr-CS']);

export function resolveLocale(locale: string): string {
  if (!locale) return 'en';
  if (FULL_LOCALE_EXCEPTIONS.has(locale)) return locale;
  if (locale.includes('-')) {
    return locale.split('-')[0].toLowerCase();
  }
  return locale.toLowerCase();
}
