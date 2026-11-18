import { brand, defaultLocale, locales } from "apps-sdk:panel-appearance";
import { connectAppHost, createContext } from "../context";

/** The panel loads its current and fallback locales. A preference change can load another locale into the same app. */
export async function connectPanelContext() {
  const host = await connectAppHost();
  const current = host.snapshot().locale;
  const selected = await Promise.all([...new Set([defaultLocale, current])]
    .filter(locale => Object.hasOwn(locales, locale))
    .map(async locale => [locale, await locales[locale]!()] as const));
  const byLocale = Object.fromEntries(selected);
  return createContext(host, {
    brand,
    defaultLocale,
    messages: Object.fromEntries(selected.map(([locale, bundle]) => [locale, bundle.messages])),
    elementLocale: locale => (byLocale[locale] ?? byLocale[defaultLocale]!).elementLocale,
    loadLocale: locale => Object.hasOwn(locales, locale) ? locales[locale]!() : undefined,
  });
}
