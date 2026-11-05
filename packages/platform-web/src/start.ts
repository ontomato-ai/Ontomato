import { followThemeChanges, initializePlatformTheme } from "../composables/useTheme";
import { createApp, type App as VueApp } from "vue";
import { createPinia, type Pinia } from "pinia";
import ElementPlus from "element-plus";
import { createRouter, createWebHashHistory, type Router, type RouteRecordRaw } from "vue-router";
import App from "../App.vue";
import { installWorkbenchI18n, type WorkbenchI18n, type WorkbenchLanguage } from "../i18n";
import { installAuthHost, type WorkbenchAuthHost } from "../utils/auth";
import { installErrorPunctuation, type ErrorPunctuation } from "../utils/error-punctuation";
import { installWorkbenchContent, type WorkbenchContent } from "../content";
import { turnDiagnosisAccessKey, type TurnDiagnosisAccess } from "../features/diagnosis/access";
import { ontologyServiceAccessKey, type OntologyServiceAccess } from "./ontology-service";
import { installBrandTheme, type BrandSource } from "@ontomato/design-tokens";
import { installWorkbenchBrand } from "../brand";

export interface WorkbenchWebOptions {
  /** This edition's brand source; the workbench colour variables and the chart colours are generated from it. */
  brand: BrandSource;
  language: WorkbenchLanguage;
  auth: WorkbenchAuthHost;
  errorPunctuation: ErrorPunctuation;
  /** Static workbench content (original matching rules and sentences; module-level code reads it at call time). */
  content: WorkbenchContent;
  /** Visibility of the chat turn diagnosis entry (components read it via inject). */
  turnDiagnosis: TurnDiagnosisAccess;
  /** Visibility of the entries that open the Ontology Service (function-area link and admin tab). */
  ontologyService: OntologyServiceAccess;
  routes: (app: VueApp, router: Router, i18n: WorkbenchI18n) => RouteRecordRaw[];
  /** App navigation guards; the Pinia instance is passed explicitly so stores in guards do not depend on mount timing. */
  installGuards?: (router: Router, pinia: Pinia) => void;
  /** App-level startup before mounting (e.g. a session watcher, originally started once in App setup). */
  beforeMount?: () => void;
}

/**
 * The single web startup order: install the brand colours, the host, punctuation, workbench content and language first
 * (module-level code reads them at call time), then create Pinia and the router and install app guards, and finally
 * install everything into the app and mount; the router's first navigation happens after Pinia is installed.
 */
export function startWorkbenchWeb(options: WorkbenchWebOptions): void {
  initializePlatformTheme();
  installBrandTheme(options.brand);
  installWorkbenchBrand(options.brand);
  installAuthHost(options.auth);
  installErrorPunctuation(options.errorPunctuation);
  installWorkbenchContent(options.content);
  const i18n = installWorkbenchI18n(options.language);
  const pinia = createPinia();
  const router = createRouter({ history: createWebHashHistory(), routes: [] });
  options.installGuards?.(router, pinia);

  const app = createApp(App);
  const followPreferences = (event: StorageEvent) => {
    followThemeChanges(event);
    const locale = options.language.storedChange?.(event);
    if (locale) i18n.global.locale.value = locale;
  };
  window.addEventListener("storage", followPreferences);
  app.onUnmount(() => window.removeEventListener("storage", followPreferences));
  app.provide(turnDiagnosisAccessKey, options.turnDiagnosis);
  app.provide(ontologyServiceAccessKey, options.ontologyService);
  app.use(i18n);
  app.use(ElementPlus);
  app.use(pinia);
  for (const route of options.routes(app, router, i18n)) router.addRoute(route);
  app.use(router);
  options.beforeMount?.();
  app.mount("#app");
}
