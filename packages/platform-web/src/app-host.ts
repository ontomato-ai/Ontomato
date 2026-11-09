import { watch } from "vue";
import type { Router } from "vue-router";
import {
  APP_HOST_GLOBAL,
  type AppHost,
  type AppHostCredential,
  type AppHostPreferences,
} from "@ontomato/contracts/app-host";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { authHost } from "@ontomato/workbench-ui/utils/auth";
import { readRuntimeConfig } from "./config";

/**
 * Installs the port for the apps this shell shows in a same-origin iframe. It hands over values and calls of this page
 * load, never its Vue state: an app runs its own Vue and SDK version. The credential and the auth failure handling are
 * the ones the edition already gives its Manager pages, so a changed identity rebuilds the page and its app frames.
 */
export function installAppHost(options: {
  credential: AppHostCredential | null;
  preferences: PlatformPreferences;
  router: Router;
  onAuthFailure(status: 401 | 402): void;
}) {
  const { preferences } = options;
  const current = (): AppHostPreferences => ({ locale: preferences.locale.value, theme: preferences.theme.value });
  (window as Window & { [APP_HOST_GLOBAL]?: AppHost })[APP_HOST_GLOBAL] = {
    snapshot() {
      const user = authHost().getUserInfo();
      return {
        ...current(),
        apiBase: readRuntimeConfig().apiBase,
        user: user && { userId: user.userId, loginCode: user.loginCode, userName: user.userName, domainId: user.domainId },
      };
    },
    credential: () => options.credential,
    subscribePreferences: (listener) => watch(current, (value) => listener(value)),
    navigate(path) {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`Not a platform route: ${path}`);
      void options.router.push(path);
    },
    onAuthFailure: options.onAuthFailure,
  };
}
