import { inject, onMounted, type App, type InjectionKey, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  createManagerClient,
  type ManagerAuthFailureStatus,
  type ManagerClient,
  type ManagerCredential,
  type ManagerDataFallbacks,
} from "./api";
import { metricViewsKey } from "./clients/metric-views";
import type { MessageKey, SharedKey, TextParams } from "./i18n";

export type ManagerTheme = "light" | "dark";

/**
 * Presentation values supplied statically by the host: each product's own display and interaction differences for the
 * Manager. There is a single component set with no edition flags; the app profile supplies these once and they do not
 * change at runtime.
 */
export interface ManagerPresentation {
  /**
   * Custom properties per theme, bound by the page on the document root: the brand's colour variables plus the
   * component-specific --manager-model-catalog-min-height (model catalog), --manager-modeling-panel-header-background (modeling right-panel
   * header) and --manager-filter-drawer-radius (data browser filter drawer).
   */
  readonly themeProperties: Readonly<Record<ManagerTheme, Readonly<Record<string, string>>>>;
  /**
   * Node palette per theme, shared by visual modeling and the instance graph; colours are picked by
   * class-name hash, so a class keeps its slot in both themes.
   */
  readonly nodePalette: Readonly<Record<ManagerTheme, readonly string[]>>;
  /** Zoom limit after visual modeling or the instance graph fits the canvas; null means no limit. */
  readonly maxFitZoom: number | null;
  /** Data browser header description; the argument is the current object type's display name, absent when none is selected. */
  readonly dataBrowserDescription: (objectLabel: string | undefined) => string;
  /** Dialogs switch to the narrow layout when the Manager pages are at most 700px wide. */
  readonly compactDialogs: boolean;
}

/** What the page supplies to the Manager pages for one page load. */
export interface ManagerOptions {
  /** Data engine proxy entry without a trailing slash; requests go to `${apiBase}/data-query/*`. */
  apiBase: string;
  /** Fixed for the page load: a credential change rebuilds the whole page. */
  credential: ManagerCredential;
  /** The page's theme and language; the Manager follows them and never changes them. */
  theme: Readonly<Ref<ManagerTheme>>;
  locale: Readonly<Ref<string>>;
  /** The page's vue-i18n translation, for the request layer's own error texts. */
  translate: (key: string, params?: TextParams) => string;
  dataFallbacks: ManagerDataFallbacks;
  presentation: ManagerPresentation;
  /** 401/402 from a Manager request; the page decides what to do. */
  onAuthFailure: (status: ManagerAuthFailureStatus) => void;
}

/** What Manager components read from the page; theme and locale are live values of the page's preferences. */
export interface ManagerContext {
  readonly apiBase: string;
  readonly credential: ManagerCredential;
  readonly theme: ManagerTheme;
  readonly locale: string;
  readonly dataFallbacks: ManagerDataFallbacks;
  readonly presentation: ManagerPresentation;
}

const contextKey: InjectionKey<ManagerContext> = Symbol("ontology-manager-context");
const clientKey: InjectionKey<ManagerClient> = Symbol("ontology-manager-client");

/**
 * The Manager's page-wide state for one page load: the context its components read and the one request client.
 * `install` provides them to the whole app, so the shell's navigation and the Manager pages share them, and provides
 * the client's MetricView reads to the `MetricViewData` the object views share with SDK apps.
 */
export function createManager(options: ManagerOptions) {
  const context: ManagerContext = {
    apiBase: options.apiBase,
    credential: options.credential,
    get theme() {
      return options.theme.value;
    },
    get locale() {
      return options.locale.value;
    },
    dataFallbacks: options.dataFallbacks,
    presentation: options.presentation,
  };
  const client = createManagerClient(
    {
      apiBase: context.apiBase,
      credential: context.credential,
      get locale() {
        return context.locale;
      },
      text: (key, params) => options.translate(`ontology.${key}`, params),
      dataFallbacks: context.dataFallbacks,
    },
    options.onAuthFailure
  );
  return {
    context,
    client,
    install(app: App) {
      app.provide(contextKey, context);
      app.provide(clientKey, client);
      app.provide(metricViewsKey, client.metricViews);
    },
  };
}

export type Manager = ReturnType<typeof createManager>;

/** Provide map for mounting Manager components outside the app (component tests). */
export function provideManager(manager: Manager) {
  return {
    [contextKey as symbol]: manager.context,
    [clientKey as symbol]: manager.client,
    [metricViewsKey as symbol]: manager.client.metricViews,
  };
}

function injectFromPage<T>(key: InjectionKey<T>): T {
  const value = inject(key);
  if (!value) throw new Error("Ontology Manager components must be mounted in an app the Manager is installed in");
  return value;
}

export function useManagerContext() {
  return injectFromPage(contextKey);
}

export function useManagerClient() {
  return injectFromPage(clientKey);
}

/** Register a mounted editor's checks; Vue Router removes them when that editor unmounts. */
export function useManagerLeaveCheck(check: () => Promise<boolean>) {
  onMounted(() => {
    onBeforeRouteLeave(check);
    onBeforeRouteUpdate(check);
  });
}

/** The Manager's own words, from the `ontology` entries of the page's vue-i18n tree. */
export function useOntologyText() {
  const { t } = useI18n();
  const ot = (key: MessageKey, params?: TextParams) => t(`ontology.${key}`, params ?? {});
  return { ot };
}

/** Words shared with the workbench, from their groups (`common`, `nav`, ...) of the page's vue-i18n tree. */
export function useSharedText() {
  const { t: translate } = useI18n();
  const t = (key: SharedKey, params?: TextParams) => translate(key, params ?? {});
  return { t };
}

/**
 * The platform's own words, from its groups (`platform`, ...) of the page's vue-i18n tree: an application's name is one
 * entry, read by the rail and by the application's own column, so the two cannot name it differently.
 */
export function usePlatformText() {
  const { t: translate } = useI18n();
  return { pt: (key: "platform.operations") => translate(key) };
}
