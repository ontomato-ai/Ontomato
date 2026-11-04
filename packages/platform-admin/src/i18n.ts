import { createI18n } from "vue-i18n";
import type { Language as ElementLocale } from "element-plus/es/locale";

/** Message tree; the platform pages read the same flat-dotted keys the workbench locale files used. */
export type PlatformMessages = { [key: string]: string | PlatformMessages };

/** Overlay leaves replace base leaves of the same key; groups merge. */
export function mergeMessages(
  base: Readonly<PlatformMessages>,
  overlay: { readonly [key: string]: string | object }
): PlatformMessages {
  const merged: PlatformMessages = { ...base };
  for (const [key, value] of Object.entries(overlay) as [string, string | PlatformMessages][]) {
    const current = merged[key];
    merged[key] = typeof value === "string" || typeof current !== "object" ? value : mergeMessages(current, value);
  }
  return merged;
}

/** One locale's platform messages and Element Plus widget locale. */
export interface PlatformLocale {
  messages: PlatformMessages;
  element: ElementLocale;
}

/**
 * The page's one vue-i18n instance. The host supplies one locale dictionary per supported locale (platform pages and
 * Manager pages together); the layout's language control sets the locale through `setLocale`, so there is a single
 * text mechanism on the page.
 */
export function createPlatformI18n(
  locales: Readonly<Record<string, PlatformLocale>>,
  initialLocale: string
) {
  const supported = Object.keys(locales);
  const fallback = supported.includes("en") ? "en" : supported[0];
  const messages = Object.fromEntries(
    Object.entries(locales).map(([locale, { messages: tree }]) => [locale, tree])
  );
  return createI18n({
    legacy: false,
    locale: supported.includes(initialLocale) ? initialLocale : fallback,
    fallbackLocale: fallback,
    messages,
  });
}

export type PlatformI18n = ReturnType<typeof createPlatformI18n>;
