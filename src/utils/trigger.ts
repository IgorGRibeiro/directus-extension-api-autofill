export function shouldSearch(
  value: string,
  lastSearched: string | null,
  regexSource?: string,
): boolean {
  if (!value || !value.trim()) return false;
  if (value === lastSearched) return false;

  if (regexSource) {
    try {
      return new RegExp(regexSource).test(value);
    } catch {
      // Invalid regex: fall back to "no gate" so a config typo never blocks search.
      return true;
    }
  }

  return true;
}
