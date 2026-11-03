import { createI18n } from "vue-i18n";
import type { Language as ElementLocale } from "element-plus/es/locale";

/** Message tree; the platform pages read the same flat-dotted keys the workbench locale files used. */
export type PlatformMessages = { [key: string]: string | PlatformMessages };

/** One locale's platform messages and Element Plus widget locale. */
export interface PlatformLocale {
  messages: PlatformMessages;
  element: ElementLocale;
}

/**
 * The platform area's vue-i18n instance. The host supplies one locale dictionary per supported locale; the page's own
 * theme and language controls set the locale through `setLocale`, so there is a single text mechanism here.
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
