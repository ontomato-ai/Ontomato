import { computed, h, ref } from "vue";
import ElementPlus from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { createPlatformI18n } from "../i18n";
import { providePlatformHost, usePageActionsOf, type PlatformPageHost } from "../context";
import { openAccess } from "../navigation";
import { ossPlatformPages, platformGroups } from "../pages";
import type { PlatformApi } from "../api";
import platformEn from "../locales/en";
import { ossSystemConfig } from "../../../../apps/workbench/web/src/manager/system-config";

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
    navigation: computed(() => ({ groups: [platformGroups.platform], pages: ossPlatformPages })),
    account: null,
    links: [],
    navigationHidden: computed(() => false),
    systemConfig: ossSystemConfig,
    separators: { detail: ": " },
    ...overrides,
  };
}

/** `global` mounting options for a platform page with the given host. */
export function pageGlobal(host: PlatformPageHost, i18n = testI18n()) {
  return { plugins: [i18n, ElementPlus], provide: providePlatformHost(host) };
}

/**
 * A stand-in for the platform layout's page header: the page under test draws no header of its own, so a test that reads
 * the Save in the header has to draw one somewhere. The real header is @ontomato/platform-shell's, drawn by
 * @ontomato/platform-web; this package cannot import it (the dependency runs the other way), so the test draws the same
 * contract by hand: the title, and the Save / Discard the page handed over through `pageActionsKey`.
 */
export const PageHeaderStandIn = {
  name: "PageHeaderStandIn",
  props: { title: { type: String, required: true } },
  setup(props: { title: string }) {
    const actions = usePageActionsOf();
    return () =>
      h("header", { class: "page-header" }, [
        h("h1", { class: "page-title" }, props.title),
        h("div", { class: "page-actions" }, [
          h("button", { disabled: !actions.value?.dirty || actions.value?.saving, onClick: () => actions.value?.discard() }, "Discard"),
          h("button", { disabled: !actions.value?.dirty || actions.value?.saving, onClick: () => actions.value?.save() }, "Save"),
        ]),
      ]);
  },
};
