/**
 * Resolves a locale-keyed map (such as `{ en: "Object types", de: "Objekttypen" }`) against the active locale.
 * Checks exact match, case-insensitive match, base language prefix match, then English/Simplified Chinese fallbacks
 * and finally the first non-empty entry.
 */
export function pickLocalizedMapText(
  map: Readonly<Record<string, string>> | null | undefined,
  activeLocale: string,
): string | undefined {
  if (!map || typeof map !== "object") return undefined;
  const lang = activeLocale.trim() || (typeof document !== "undefined" ? (document.documentElement.lang || "").trim() : "");
  if (lang) {
    const exact = map[lang];
    if (typeof exact === "string" && exact.trim()) return exact;
    const lowerLang = lang.toLowerCase();
    const ciExact = Object.entries(map).find(
      ([key, value]) => key.toLowerCase() === lowerLang && typeof value === "string" && value.trim(),
    );
    if (ciExact) return ciExact[1];
    const base = lowerLang.split("-")[0];
    if (base) {
      const prefixMatch = Object.entries(map).find(
        ([key, value]) => key.toLowerCase().split("-")[0] === base && typeof value === "string" && value.trim(),
      );
      if (prefixMatch) return prefixMatch[1];
    }
  }
  if (typeof map.en === "string" && map.en.trim()) return map.en;
  if (typeof map["zh-CN"] === "string" && map["zh-CN"].trim()) return map["zh-CN"];
  const first = Object.values(map).find((value) => typeof value === "string" && value.trim());
  return first;
}

/**
 * Resolves an authored UI string with consistent SDK priority:
 * 1. `key` via the enclosing panel's message catalogue (`panel.t`), then platform i18n (`te`/`t`);
 * 2. `map` localized record matched against the reactive locale;
 * 3. `fallback` literal string;
 * 4. `key` itself if provided and unresolved.
 */
export function resolveLocalizedText(options: {
  key?: string;
  map?: Readonly<Record<string, string>> | null;
  fallback?: string;
  locale: string;
  panelText?: (key: string) => string;
  t: (key: string) => string;
  te: (key: string) => boolean;
}): string {
  const { key, map, fallback, locale, panelText, t, te } = options;
  if (key && key.trim()) {
    if (panelText) {
      const fromPanel = panelText(key);
      if (fromPanel !== key) return fromPanel;
    }
    if (te(key)) return t(key);
  }
  const fromMap = pickLocalizedMapText(map, locale);
  if (fromMap !== undefined) return fromMap;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return key ?? "";
}

/** Reads a non-empty string property from a raw projection config record, trying candidate keys in order. */
export function readConfigString(
  config: Readonly<Record<string, unknown>> | undefined,
  ...keys: readonly string[]
): string | undefined {
  if (!config) return undefined;
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Reads a string-map property from a raw projection config record. */
export function readConfigStringMap(
  config: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, string>> | undefined {
  if (!config) return undefined;
  const raw = config[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
