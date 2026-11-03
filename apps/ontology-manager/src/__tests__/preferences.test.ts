import { beforeEach, describe, expect, it } from "vitest";
import { syncLocale, syncTheme } from "../preferences";
import { isolateShellPerTest } from "./isolation";

const resetShell = isolateShellPerTest();

describe("Manager page preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    window.history.replaceState({}, "", "/");
  });

  it("theme: the Manager's stored preference or light; invalid values fall back to light", () => {
    localStorage.setItem("ontology_manager_theme", "dark");
    expect(syncTheme().theme.value).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    resetShell();
    localStorage.setItem("ontology_manager_theme", "blue");
    expect(syncTheme().theme.value).toBe("light");
  });

  it("theme: the workbench key and URL parameters are not read; a choice is stored only under the Manager key", () => {
    localStorage.setItem("theme-preference", "dark");
    window.history.replaceState({}, "", "/?theme=dark");
    const { theme, setTheme } = syncTheme();
    expect(theme.value).toBe("light");
    setTheme("dark");
    expect(localStorage.getItem("ontology_manager_theme")).toBe("dark");
    expect(localStorage.getItem("theme-preference")).toBe("dark");
    setTheme("light");
    expect(localStorage.getItem("theme-preference")).toBe("dark");
  });

  it("theme: follows other Manager tabs, not the workbench", () => {
    const { theme } = syncTheme();
    window.dispatchEvent(new StorageEvent("storage", { key: "theme-preference", newValue: "dark" }));
    expect(theme.value).toBe("light");
    window.dispatchEvent(new StorageEvent("storage", { key: "ontology_manager_theme", newValue: "dark" }));
    expect(theme.value).toBe("dark");
  });

  it("locale: stored supported value → default; ar is rtl; a choice is stored under the Manager key only", () => {
    localStorage.setItem("ontology_manager_locale", "ar");
    expect(syncLocale("zh-CN", ["zh-CN", "en", "ar"]).locale.value).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    resetShell();
    localStorage.setItem("ontology_manager_locale", "xx");
    localStorage.setItem("app-locale", "en");
    const { locale, setLocale } = syncLocale("zh-CN", ["zh-CN", "en", "ar"]);
    expect(locale.value).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");
    setLocale("xx");
    expect(locale.value).toBe("zh-CN");
    setLocale("en");
    expect(locale.value).toBe("en");
    expect(localStorage.getItem("ontology_manager_locale")).toBe("en");
    expect(localStorage.getItem("app-locale")).toBe("en");
  });

  it("locale: follows other Manager tabs with supported values only", () => {
    const { locale } = syncLocale("zh-CN", ["zh-CN", "en"]);
    window.dispatchEvent(new StorageEvent("storage", { key: "app-locale", newValue: "en" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "ontology_manager_locale", newValue: "xx" }));
    expect(locale.value).toBe("zh-CN");
    window.dispatchEvent(new StorageEvent("storage", { key: "ontology_manager_locale", newValue: "en" }));
    expect(locale.value).toBe("en");
  });
});
