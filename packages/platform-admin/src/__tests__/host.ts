import { computed, ref } from "vue";
import ElementPlus from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { createPlatformI18n } from "../i18n";
import { providePlatformHost, type PlatformPageHost } from "../context";
import { openAccess } from "../navigation";
import { ossNavigation } from "../pages";
import type { PlatformApi } from "../api";
import platformEn from "../locales/en";
import { ossSystemConfig } from "../../../../apps/ontology-manager/src/system-config";

export function testI18n() {
  return createPlatformI18n({ en: { messages: platformEn, element: en } }, "en");
}

/** A platform host for mounting one page in a component test; `api` holds the endpoints the page under test calls. */
export function testHost(api: Partial<PlatformApi>, overrides: Partial<PlatformPageHost> = {}): PlatformPageHost {
  return {
    access: openAccess,
    api: api as PlatformApi,
    preferences: {
      locales: ["en"],
      locale: ref("en"),
      setLocale: () => {},
      theme: ref("light"),
      setTheme: () => {},
    },
    navigation: computed(() => ossNavigation),
    account: null,
    actions: [],
    navigationHidden: computed(() => false),
    openWorkspace: () => {},
    systemConfig: ossSystemConfig,
    separators: { detail: ": " },
    ...overrides,
  };
}

/** `global` mounting options for a platform page with the given host. */
export function pageGlobal(host: PlatformPageHost, i18n = testI18n()) {
  return { plugins: [i18n, ElementPlus], provide: providePlatformHost(host) };
}
