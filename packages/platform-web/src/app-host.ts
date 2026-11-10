import type { AppExecutionContext } from "@ontomato/contracts/build-tests";
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

const executionBindings = new WeakMap<object, AppExecutionContext>();
const executionListeners = new WeakMap<object, Set<(context: AppExecutionContext) => void>>();
function assertFrameBinding(previous: AppExecutionContext | undefined, next: AppExecutionContext) {
  if(next.kind!=="build-test" || previous && (previous.kind!=="build-test" || previous.contextId!==next.contextId || previous.workspaceId!==next.workspaceId))
    throw new Error("Reload the preview frame to change its execution context");
}
/** Register before the frame runs. Updating its ID requires a new frame. */
export function registerBuildPreview(source: object, context: AppExecutionContext) {
  assertFrameBinding(executionBindings.get(source),context);
  executionBindings.set(source, context);
  return {
    update(next: AppExecutionContext) {
      const previous=executionBindings.get(source);
      assertFrameBinding(previous,next);
      executionBindings.set(source,next);
      for(const listener of executionListeners.get(source) ?? []) listener(next);
    },
    // Keep the last binding until the Window is collected: detached frames must never become live.
    dispose() { executionListeners.delete(source); },
  };
}

type PageContextListener = AppHost["setPageContext"];
const pageContextListeners = new Set<PageContextListener>();

/**
 * Hears every app frame of this window say what its reader looks at (`AppHost.setPageContext`) until the returned
 * function is called; `source` tells the frames apart. A page that shows an app beside its agent listens while it is
 * open (the app builder, for its preview); with no one listening, the call has no effect.
 */
export function subscribeAppPageContext(listener: PageContextListener) {
  pageContextListeners.add(listener);
  return () => {
    pageContextListeners.delete(listener);
  };
}

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
    executionContext: (source) => executionBindings.get(source) ?? { kind: "live" },
    subscribeExecutionContext(source, listener) {
      const listeners=executionListeners.get(source) ?? new Set();executionListeners.set(source,listeners);listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    credential: () => options.credential,
    subscribePreferences: (listener) => watch(current, (value) => listener(value)),
    navigate(path) {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`Not a platform route: ${path}`);
      void options.router.push(path);
    },
    onAuthFailure: options.onAuthFailure,
    setPageContext(source, context) {
      for (const listener of pageContextListeners) listener(source, context);
    },
  };
}
