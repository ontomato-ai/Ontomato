import type { AppExecutionContext } from "@ontomato/contracts/build-tests";
import { computed, readonly, ref, shallowRef, watch, type App, type Ref } from "vue";
import { createI18n } from "vue-i18n";
import { provideGlobalConfig } from "element-plus";
import { chartTheme } from "@ontomato/foundation-ui/chart";
import { installBrandTheme } from "@ontomato/design-tokens";
import {
  APP_HOST_GLOBAL,
  type AppHost,
  type AppHostPreferences,
  type AppHostTheme,
  type AppHostUser,
  type AppPageContext,
} from "@ontomato/contracts/app-host";
import MetricViewData from "@ontomato/ontology-manager/app-components/MetricViewData.vue";
import {
  createActionsClient,
  createProductsClient,
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
  /** Mount an existing asset through the shell runtime; dispose when the container is removed. Live apps only. */
  mountProductAsset(element:HTMLElement,assetId:string):()=>void;
  readonly executionContext: AppExecutionContext;
  /** The signed-in user, for display only; null in the open-source edition. */
  readonly user: AppHostUser | null;
  /** The platform's language, e.g. `zh-CN`; it follows the platform while the app is open. */
  readonly locale: Readonly<Ref<string>>;
  /** The platform's theme; the page's `<html>` carries the `dark` class while it is dark. */
  readonly theme: Readonly<Ref<AppHostTheme>>;
  /**
   * The ECharts theme the platform's own charts are drawn in, for the current light or dark mode: the edition's brand
   * colours for the series and the sequential scale, its text and line colours. Pass it to
   * `<e-chart :theme="chartTheme">`; the chart follows the platform when it changes.
   */
  readonly chartTheme: Readonly<Ref<Record<string, unknown>>>;
  /** Reads published MetricViews: `read({ id, parameters })` resolves to the MetricView's result. */
  readonly metricViews: MetricViewsClient;
  /**
   * Executes Actions. `form({ id })` reads an Action's form, its fields and their initial text, to draw with
   * `<form-fields>`; `form({ id, values })` answers what the fields hold with the field errors, or with the typed
   * parameters that `execute({ id, parameters })` takes. `execute` resolves to the execution result.
   */
  readonly actions: ActionsClient;
  /** Product assets use the same IDs and revision checks as manual authoring. */
  readonly products: ReturnType<typeof createProductsClient>;
  /** Opens a platform page in the shell, e.g. `navigate("/ontology/objects")`. */
  navigate(path: string): void;
  /**
   * Tells the platform what the reader looks at: the app's own page and the object selected on it, or `null`. Call it
   * when the page starts, when the reader moves to another page of the app, and when they select an object or clear
   * the selection. Where the platform shows the app beside its agent (the app builder's preview), the reader's messages
   * carry it, so "this one" means that object; elsewhere it has no effect. Throws a `TypeError` unless `page` and each
   * field of `selection` are non-empty strings.
   */
  setPageContext(context: AppPageContext): void;
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

const isText = (value: unknown) => typeof value === "string" && value.trim() !== "";

/** The page context as the app wrote it, checked here: the page is plain script, the platform reads typed values. */
function checkPageContext({ page, selection }: AppPageContext) {
  if (!isText(page)) throw new TypeError("setPageContext: page must be the page's name, a non-empty string");
  if (selection !== null && !(isText(selection?.className) && isText(selection.primaryKey) && isText(selection.name)))
    throw new TypeError("setPageContext: selection must be null or { className, primaryKey, name }, each a non-empty string");
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
  // The platform's chart theme, read from the brand stylesheet installed above, which holds both modes: read again once
  // a switch of the platform's theme has switched the `dark` class.
  const charts = shallowRef(chartTheme());
  watch(theme, () => {
    charts.value = chartTheme();
  });
  const stop = host.subscribePreferences(follow);
  // The room the shell's own controls cover at the frame's foot, which the stylesheet keeps after the page's content:
  // the shell's own value, read by the same class the platform's pages use.
  const stopInsets = host.subscribeFrameInsets(window, ({ bottom }) =>
    document.documentElement.style.setProperty("--pane-dock-space", `${bottom}px`),
  );
  // The shell outlives this frame: stop its listeners when the frame goes away, not when the page is only cached.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    stop();
    stopInsets();
  });

  const transport = createManagerRequest(
    {
      apiBase: snapshot.apiBase,
      get executionContext() { return host.executionContext(window); },
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
    mountProductAsset(element,assetId){
      if(!host.mountProductAsset)throw new Error('This platform version does not support product asset embedding');
      return host.mountProductAsset(window,element,assetId);
    },
    get executionContext() { return host.executionContext(window); },
    user: snapshot.user,
    locale: readonly(locale),
    theme: readonly(theme),
    chartTheme: charts,
    metricViews,
    actions: createActionsClient(transport),
    products: createProductsClient(transport),
    navigate: (path) => host.navigate(path),
    // The page's own window tells the shell which of its app frames speaks.
    setPageContext(value) {
      checkPageContext(value);
      host.setPageContext(window, value);
    },
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
