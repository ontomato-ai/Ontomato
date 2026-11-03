import { computed, createApp, defineComponent, h, watch } from "vue";
import { RouterView, type NavigationGuard, type RouteRecordRaw } from "vue-router";
import ElementPlus, { ElConfigProvider } from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import { createPlatformRouter, type PlatformPageComponents } from "./router";
import PlatformLayout from "./layout/PlatformLayout.vue";
import { platformHostKey, type PlatformPageHost, type PlatformTheme } from "./context";
import type { PlatformNavigation } from "./navigation";
import type { PlatformI18n, PlatformLocale } from "./i18n";
import "./styles/platform.css";
import "./styles/admin-common.css";

/** Assembly input of the platform area; the host supplies everything edition-specific. */
export interface PlatformAdminOptions {
  /** Navigation pages (paths and permissions the router guards), in display order. */
  navigation: PlatformNavigation;
  /** Page components keyed by navigation path. */
  components: PlatformPageComponents;
  /** Pages rendered without the platform layout (sign-in, SSO callback, super admin console). */
  standalone?: readonly RouteRecordRaw[];
  /** Host guard run before the permission guard. */
  guard?: NavigationGuard;
  host: PlatformPageHost<any>;
  /** vue-i18n instance built from this edition's platform locales by `createPlatformI18n`. */
  i18n: PlatformI18n;
  /** The same locales, for the Element Plus widget locale. */
  locales: Readonly<Record<string, PlatformLocale>>;
  /** This edition's brand and neutral colour variables per theme (the Manager's presentation values). */
  themeProperties: Readonly<Record<PlatformTheme, Readonly<Record<string, string>>>>;
}

/**
 * Mounts the platform area into #app: one vue-router (hash mode) for the platform pages and one vue-i18n for their
 * text. The Ontology Manager workspace is the other area of the same page; the shell starts only one of them per page
 * load, so only one router owns the hash.
 */
export function startPlatformAdmin(options: PlatformAdminOptions) {
  const { host, i18n } = options;
  const router = createPlatformRouter({
    navigation: options.navigation,
    standalone: options.standalone ?? [],
    access: host.access,
    components: options.components,
    guard: options.guard,
    layout: PlatformLayout,
  });

  // The page's language control drives the platform text; vue-i18n holds no language of its own.
  watch(
    host.preferences.locale,
    (locale) => {
      if (locale in options.locales) i18n.global.locale.value = locale;
    },
    { immediate: true }
  );

  // Tokens and brand colours live on the document root so teleported dialogs and popovers read them too.
  const root = document.documentElement;
  root.classList.add("platform-document");
  watch(
    host.preferences.theme,
    (theme, previous) => {
      for (const name of Object.keys(previous ? options.themeProperties[previous] : {})) root.style.removeProperty(name);
      for (const [name, value] of Object.entries(options.themeProperties[theme])) root.style.setProperty(name, value);
    },
    { immediate: true }
  );

  const app = createApp(
    defineComponent({
      name: "PlatformAdminRoot",
      setup() {
        const element = computed(() => options.locales[host.preferences.locale.value]?.element);
        return () =>
          h(ElConfigProvider, { locale: element.value }, () => h("div", { class: "platform-area" }, [h(RouterView)]));
      },
    })
  );
  app.provide(platformHostKey, host);
  app.use(i18n);
  app.use(ElementPlus);
  app.use(router);
  app.mount("#app");
  return { app, router };
}
