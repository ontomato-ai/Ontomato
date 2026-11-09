import { computed, readonly, ref, type App, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import { provideGlobalConfig } from "element-plus";
import { installBrandTheme } from "@ontomato/design-tokens";
import {
  APP_HOST_GLOBAL,
  type AppHost,
  type AppHostPreferences,
  type AppHostTheme,
  type AppHostUser,
} from "@ontomato/contracts/app-host";
import MetricViewData from "@ontomato/ontology-manager/app-components/MetricViewData.vue";
import {
  createActionsClient,
  createManagerRequest,
  createMetricViewsClient,
  metricViewsKey,
  type ActionsClient,
  type ManagerRequest,
  type MetricViewsClient,
} from "@ontomato/ontology-manager/clients";
import edition from "apps-sdk:edition";

/** What an app gets from the platform shell it runs in. */
export interface AppContext {
  /** The signed-in user, for display only; null in the open-source edition. */
  readonly user: AppHostUser | null;
  /** The platform's language, e.g. `zh-CN`; it follows the platform while the app is open. */
  readonly locale: Readonly<Ref<string>>;
  /** The platform's theme; the page's `<html>` carries the `dark` class while it is dark. */
  readonly theme: Readonly<Ref<AppHostTheme>>;
  /** Reads published MetricViews: `read({ id, parameters })` resolves to the MetricView's result. */
  readonly metricViews: MetricViewsClient;
  /** Executes Actions: `execute({ id, parameters })` resolves to the execution result. */
  readonly actions: ActionsClient;
  /** Opens a platform page in the shell, e.g. `navigate("/ontology/objects")`. */
  navigate(path: string): void;
  /** Installs the context into a Vue app: the platform's words, Element Plus's locale and `<metric-view-data>`. */
  install(app: App): void;
}

/**
 * The request layer behind each context. Only the SDK's own clients use it: an app reaches the platform through those
 * clients, never through a request to any platform path, so its calls stay within the documented contract.
 */
const transports = new WeakMap<AppContext, ManagerRequest>();

/** The request layer of a context, for the SDK's own modules. */
export function contextTransport(context: AppContext) {
  const transport = transports.get(context);
  if (!transport) throw new Error("Pass the context createAppContext() returned");
  return transport;
}

/**
 * Connects the app to the platform shell around it: identity, language and theme come from the shell's app host, and
 * every request carries the shell's current credential. Call it once per page, inside the shell's app frame.
 */
export function createAppContext(): AppContext {
  const host = (window.parent as Window & { [APP_HOST_GLOBAL]?: AppHost })[APP_HOST_GLOBAL];
  if (!host) throw new Error("No platform shell around this page: Ontomato apps run in the shell's app frame");
  const snapshot = host.snapshot();
  const { language, managerMessages } = edition;
  const i18n = createI18n({
    legacy: false,
    locale: snapshot.locale,
    fallbackLocale: language.defaultLocale,
    messages: Object.fromEntries(
      language.supported.map((locale) => [locale, { ...language.messages[locale], ontology: managerMessages[locale].ontology }]),
    ),
  });
  const locale = ref(snapshot.locale);
  const theme = ref(snapshot.theme);
  const follow = (preferences: AppHostPreferences) => {
    locale.value = i18n.global.locale.value = preferences.locale;
    theme.value = preferences.theme;
    document.documentElement.lang = preferences.locale;
    document.documentElement.classList.toggle("dark", preferences.theme === "dark");
  };
  installBrandTheme(edition.brand);
  follow(snapshot);
  const stop = host.subscribePreferences(follow);
  // The shell outlives this frame: stop its listener when the frame goes away, not when the page is only cached.
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) stop();
  });

  const transport = createManagerRequest(
    {
      apiBase: snapshot.apiBase,
      get credential() {
        return host.credential();
      },
      get locale() {
        return locale.value;
      },
      text: (key, params) => i18n.global.t(`ontology.${key}`, params ?? {}),
    },
    (status) => host.onAuthFailure(status),
  );
  const metricViews = createMetricViewsClient(transport);
  const context: AppContext = {
    user: snapshot.user,
    locale: readonly(locale),
    theme: readonly(theme),
    metricViews,
    actions: createActionsClient(transport),
    navigate: (path) => host.navigate(path),
    install(app) {
      app.use(i18n);
      provideGlobalConfig(computed(() => ({ locale: language.elementLocale(locale.value) })), app, true);
      app.provide(metricViewsKey, metricViews);
      app.component("MetricViewData", MetricViewData);
    },
  };
  transports.set(context, transport);
  return context;
}
