import { ref, type Ref } from "vue";
import type { ManagerTheme } from "@ontomato/ontology-manager";

/*
 * The Manager page owns its preferences under its own keys. The workbench keeps its own keys on the same origin, so the
 * two pages never switch each other's theme or language implicitly.
 */
const THEME_KEY = "ontology_manager_theme";
const LOCALE_KEY = "ontology_manager_locale";

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

function normalizeTheme(value: string | null): ManagerTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

export interface ThemePreference {
  theme: Ref<ManagerTheme>;
  setTheme(value: ManagerTheme): void;
}

/** Document theme: the stored preference or light, applied to html.dark and followed across Manager tabs. */
export function syncTheme(): ThemePreference {
  const theme = ref<ManagerTheme>("light");
  const apply = (value: ManagerTheme) => {
    theme.value = value;
    document.documentElement.classList.toggle("dark", value === "dark");
  };
  apply(normalizeTheme(readStored(THEME_KEY)) || "light");

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY) return;
    const value = normalizeTheme(event.newValue);
    if (value) apply(value);
  });
  return {
    theme,
    setTheme(value) {
      apply(value);
      writeStored(THEME_KEY, value);
    },
  };
}

export interface LocalePreference {
  locale: Ref<string>;
  setLocale(value: string): void;
}

/** UI locale: the stored preference or the app default, accepting only supported locales, followed across Manager tabs. */
export function syncLocale(defaultLocale: string, supported: readonly string[]): LocalePreference {
  const normalize = (value: string | null) => (value && supported.includes(value) ? value : null);
  const locale = ref(defaultLocale);
  const apply = (value: string) => {
    locale.value = value;
    document.documentElement.lang = value;
    document.documentElement.dir = value === "ar" ? "rtl" : "ltr";
  };
  apply(normalize(readStored(LOCALE_KEY)) || defaultLocale);

  window.addEventListener("storage", (event) => {
    if (event.key !== LOCALE_KEY) return;
    const value = normalize(event.newValue);
    if (value) apply(value);
  });
  return {
    locale,
    setLocale(value) {
      const next = normalize(value);
      if (!next) return;
      apply(next);
      writeStored(LOCALE_KEY, next);
    },
  };
}
