import { computed, createApp, defineComponent, h, watch, type App } from "vue";
import { RouterView, type NavigationGuard, type RouteRecordRaw, type Router } from "vue-router";
import ElementPlus, { ElConfigProvider } from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import { createPlatformRouter } from "./router";
import ServiceLayout from "./layout/ServiceLayout.vue";
import { platformHostKey, type PlatformPageHost, type PlatformTheme } from "./context";
import type { PlatformNavigation } from "./navigation";
import type { PlatformI18n, PlatformLocale } from "./i18n";
import "./styles/platform.css";
import "./styles/admin-common.css";

/** Assembly input of the Ontology Service page; the host supplies everything edition-specific. */
export interface PlatformAdminOptions {
  /** Navigation groups and pages (paths and permissions the router guards), in display order. */
  navigation: PlatformNavigation;
  /** Routes inside the service layout: the Manager's and the platform pages' (`pageRoutes`). */
  routes: readonly RouteRecordRaw[];
  /** Where the root address lands (the deployment's start page). */
  home: string;
  /** Pages rendered without the platform layout (sign-in, SSO callback, super admin console). */
  standalone?: readonly RouteRecordRaw[];
  /** Host guard run before the permission guard. */
  guard?: NavigationGuard;
  host: PlatformPageHost<any>;
  /** The page's one vue-i18n instance, built from this edition's locales by `createPlatformI18n`. */
  i18n: PlatformI18n;
  /** The same locales, for the Element Plus widget locale. */
  locales: Readonly<Record<string, PlatformLocale>>;
  /** This edition's brand and neutral colour variables per theme (the Manager's presentation values). */
  themeProperties: Readonly<Record<PlatformTheme, Readonly<Record<string, string>>>>;
  /** Edition setup before mounting (its own provides, router hooks). */
  configure?: (app: App, router: Router) => void;
}

/**
 * Mounts the Ontology Service page into #app: one vue-router (hash mode) for every page — ontology, assets, knowledge
 * and platform administration inside one layout, plus the standalone pages — and one vue-i18n for all their text.
 */
export function startPlatformAdmin(options: PlatformAdminOptions) {
  const { host, i18n } = options;
  const router = createPlatformRouter({
    navigation: options.navigation,
    routes: options.routes,
    home: options.home,
    standalone: options.standalone ?? [],
    access: host.access,
    guard: options.guard,
    layout: ServiceLayout,
  });

  // The page's language control drives the text and the tab title; vue-i18n holds no language of its own.
  watch(
    host.preferences.locale,
    (locale) => {
      if (locale in options.locales) i18n.global.locale.value = locale;
      document.title = i18n.global.t("platform.serviceName");
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
  options.configure?.(app, router);
  app.mount("#app");
  return { app, router };
}
