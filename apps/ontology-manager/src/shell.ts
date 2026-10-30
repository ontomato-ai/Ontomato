import { createApp, h, ref } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import {
  OntologyManager,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerDataFallbacks,
  type ManagerKnowledgeTagValues,
  type ManagerPresentation,
} from "@ontomato/ontology-manager";
import { ontologyText, type ManagerMessages } from "@ontomato/ontology-manager/i18n";
import { readRuntimeConfig } from "./config";
import { clearSessionCredential, consumeLaunchCredential, sessionCredential } from "./credential";
import { syncLocale, syncTheme, type LocaleSync } from "./preferences";
import { syncView } from "./view";
import "./style.css";

export type { LocaleSync };

/** Every static difference between the two products' standalone shells. */
export interface ManagerShellProfile {
  /** Value handed to the component when this tab has no credential: explicit anonymous (open source) or null (stop requests and report the missing credential). */
  noCredential: ManagerCredential | null;
  /** Theme message type sent by the main system. */
  themeMessage: string;
  /** UI locale: the fixed locale without sync, otherwise the default locale. */
  locale: string;
  localeSync: LocaleSync | null;
  /** Messages per supported locale; its keys are the locales the shell accepts. */
  messages: Readonly<Record<string, ManagerMessages>>;
  /** Fixed data defaults, independent of the UI locale. */
  dataFallbacks: ManagerDataFallbacks;
  /** This product's Manager presentation values (theme values, node palette, graph interaction, narrow dialogs, etc.). */
  presentation: ManagerPresentation;
  /** This product's stored values for the business knowledge tags. */
  knowledgeTagValues: ManagerKnowledgeTagValues;
}

const STALE_BUILD_RELOAD_KEY = "ontology_manager_stale_build_reload";

/*
 * Pages load as hashed chunks on first entry. After a redeployment an open tab still runs the old entry, whose chunks
 * no longer exist; reload once so the tab picks up the new build (the view is kept in the hash). The key records which
 * entry already reloaded, so a chunk that still fails after the reload surfaces its error instead of reloading in a loop.
 */
function reloadOnStaleBuild() {
  window.addEventListener("vite:preloadError", (event) => {
    const entry = import.meta.url;
    if (sessionStorage.getItem(STALE_BUILD_RELOAD_KEY) === entry) return;
    sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, entry);
    event.preventDefault();
    window.location.reload();
  });
}

export function startManagerShell(profile: ManagerShellProfile) {
  reloadOnStaleBuild();
  consumeLaunchCredential();
  const credential = ref(sessionCredential(profile.noCredential));
  const authExpired = ref(false);
  const theme = syncTheme(profile.themeMessage);
  const locale = profile.localeSync
    ? syncLocale(profile.locale, Object.keys(profile.messages), profile.localeSync)
    : ref(profile.locale);
  const messages = () => profile.messages[locale.value];
  const { apiBase, initialRoute } = readRuntimeConfig();
  const { view, replaceView } = syncView(initialRoute);

  const embedded = new URLSearchParams(window.location.search).get("embedded") === "1";

  // 401 means authentication expired: clear this tab's credential and stop requests. 402 (license failure) keeps the credential; the component shows the error.
  function onAuthFailure(status: ManagerAuthFailureStatus) {
    if (status !== 401) return;
    clearSessionCredential();
    credential.value = null;
    authExpired.value = true;
  }

  createApp({
    render: () =>
      credential.value
        ? h(OntologyManager, {
            apiBase,
            credential: credential.value,
            locale: locale.value,
            messages: messages(),
            theme: theme.value,
            view: view.value,
            dataFallbacks: profile.dataFallbacks,
            presentation: profile.presentation,
            knowledgeTagValues: profile.knowledgeTagValues,
            embedded,
            "onUpdate:view": replaceView,
            onAuthFailure,
          })
        : h(
            "p",
            { class: "manager-shell-status", role: "alert" },
            authExpired.value
              ? ontologyText(messages(), "requestFailedStatus", { status: 401 })
              : ontologyText(messages(), "credentialMissing")
          ),
  }).mount("#app");
}
