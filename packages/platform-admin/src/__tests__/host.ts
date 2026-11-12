import { computed, defineComponent, h, ref, type Component, type Ref } from "vue";
import type { VueWrapper } from "@vue/test-utils";
import { RouterView, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ElementPlus, { ElMessageBox } from "element-plus";
import en from "element-plus/es/locale/lang/en";
import {
  PlatformPageHeader,
  providePageActions,
  provideUnsavedChanges,
  type PlatformPageActions,
} from "@ontomato/platform-shell";
import { createPlatformI18n } from "../i18n";
import { providePlatformHost, type PlatformPageHost } from "../context";
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
 * A stand-in for the platform's frame around the page under test: the shell's page header with what the page handed
 * over, and the frame's question before the address leaves a dirty draft. The real frame is @ontomato/platform-web's;
 * this package cannot import it (the dependency runs the other way), so the test assembles the same shell parts.
 */
export const PageFrameStandIn = defineComponent({
  name: "PageFrameStandIn",
  props: { title: { type: String, required: true } },
  setup(props) {
    const actions = providePageActions();
    const { t } = useI18n();
    const unsaved = provideUnsavedChanges(() =>
      ElMessageBox.confirm(t("admin.leaveUnsavedConfirm"), t("admin.unsavedChanges")).then(
        () => true,
        () => false
      )
    );
    useRouter().beforeEach((to) => unsaved.allows(to.path));
    return () =>
      h("div", [
        h(PlatformPageHeader, {
          title: props.title,
          actions: actions.value?.actions,
          draft: actions.value?.draft ?? null,
          labels: { save: "Save", discard: "Discard", unsavedChanges: "Unsaved changes" },
          onSave: () => actions.value?.draft?.save(),
          onDiscard: () => actions.value?.draft?.discard(),
        }),
        h(RouterView),
      ]);
  },
});

/** A page mounted under a frame that only collects what it hands to its header, without a router. */
export function framedPage(page: Component) {
  let actions: Readonly<Ref<PlatformPageActions | null>> | null = null;
  const Frame = defineComponent({
    name: "FrameStandIn",
    setup() {
      actions = providePageActions();
      provideUnsavedChanges(async () => true);
      return () => h(page);
    },
  });
  return { Frame, actions: () => actions!.value };
}

/** A button of the header the frame stand-in draws, by its text. */
export const headerButton = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll(".platform-page-header .page-actions button").find((button) => button.text() === text);
