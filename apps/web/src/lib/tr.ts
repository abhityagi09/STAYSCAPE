/**
 * Source-text translation (gettext style): `tr('Find a stay')` returns the active language's
 * translation of that exact English text, or the English text itself when there is none.
 *
 * It needs no hook, so it also works in option lists and labels defined outside components.
 * The I18nProvider re-renders the app when the language changes (see lib/i18n.tsx), so every
 * `tr()` call is evaluated again. Hindi strings live in lib/locales/hi.ts and are loaded only
 * when Hindi is selected.
 */
export type Language = 'en' | 'hi';

let active: Language = 'en';
let dictionary: Record<string, string> = {};

export function tr(english: string): string;
export function tr(english: string | undefined): string | undefined;
export function tr(english: string | undefined): string | undefined {
  if (english === undefined || active === 'en') return english;
  return dictionary[english] ?? english;
}

export function currentLanguage(): Language {
  return active;
}

/** Load the language's dictionary (if any) and make it active. */
export async function activateLanguage(language: Language): Promise<void> {
  if (language === 'en') {
    active = 'en';
    dictionary = {};
    return;
  }
  const mod = await import('./locales/hi');
  dictionary = mod.hi;
  active = language;
}

/**
 * Interpolating variant: `trf('Only {0} left', [n])`. The key keeps `{0}`, `{1}` … placeholders,
 * so a translation may reorder them — or omit one, e.g. an English plural suffix.
 */
export function trf(template: string, values: ReadonlyArray<unknown>): string {
  const pattern = active === 'en' ? template : (dictionary[template] ?? template);
  return pattern.replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)] ?? ''));
}
