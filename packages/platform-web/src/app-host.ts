import type { AppExecutionContext } from "@ontomato/contracts/build-tests";
import { watch,createVNode,render,type App } from "vue";
import ProductRoute from './pages/ProductRoute.vue';
import type { Router } from "vue-router";
import {
  APP_HOST_GLOBAL,
  type AppFrameInsets,
  type AppHost,
  type AppHostCredential,
  type AppHostPreferences,
} from "@ontomato/contracts/app-host";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { authHost } from "@ontomato/workbench-ui/utils/auth";
import { readRuntimeConfig } from "./config";

const executionBindings = new WeakMap<object, AppExecutionContext>();
const executionListeners = new WeakMap<object, Set<(context: AppExecutionContext) => void>>();
const frameInsets = new WeakMap<object, AppFrameInsets>();
const insetListeners = new WeakMap<object, Set<(insets: AppFrameInsets) => void>>();
const NO_INSETS: AppFrameInsets = { bottom: 0 };
/** Mounted after the shell installs its context, router and identity providers. */
export function installProductEmbedding(app:App){
  const host=(window as Window & {[APP_HOST_GLOBAL]?:AppHost})[APP_HOST_GLOBAL];
  if(!host)return;
  host.mountProductAsset=(source,target,assetId)=>{
    const element=target as HTMLElement;
    if(executionContext(source).kind!=='live')throw new Error('Product embedding is unavailable in build-test previews; use product authoring commands');
    if(!element?.ownerDocument?.defaultView||!(element instanceof element.ownerDocument.defaultView.HTMLElement)||element.ownerDocument.defaultView!==source)throw new Error('Product mount must belong to the registered app frame');
    if(!assetId.trim()||assetId.length>200)throw new Error('Invalid product asset ID');
    const shadow=element.shadowRoot??element.attachShadow({mode:'open'});
    shadow.replaceChildren();
    const syncStyles=()=>{
      shadow.querySelectorAll('[data-product-style]').forEach(node=>node.remove());
      for(const style of document.head.querySelectorAll('style,link[rel="stylesheet"]')){
        const clone=style.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-product-style','');
        if(clone.tagName==='LINK')clone.setAttribute('href',(style as HTMLLinkElement).href);
        shadow.prepend(clone);
      }
    };
    syncStyles();
    const observer=new MutationObserver(syncStyles);observer.observe(document.head,{childList:true,subtree:true,characterData:true});
    const container=element.ownerDocument.createElement('div');container.style.minWidth='0';shadow.append(container);
    const vnode=createVNode(ProductRoute,{productAssetId:assetId,embedded:true});vnode.appContext=app._context;
    render(vnode,container);
    return ()=>{observer.disconnect();render(null,container);shadow.replaceChildren();};
  };
}
function assertFrameBinding(previous: AppExecutionContext | undefined, next: AppExecutionContext) {
  if(previous && (previous.kind!==next.kind || previous.kind==="build-test" && next.kind==="build-test" && (previous.contextId!==next.contextId || previous.workspaceId!==next.workspaceId)))
    throw new Error("Reload the preview frame to change its execution context");
}
/** Register before the frame runs. Updating its ID requires a new frame. */
function registerFrame(source: object, context: AppExecutionContext) {
  assertFrameBinding(executionBindings.get(source),context);
  executionBindings.set(source, context);
  return {
    update(next: AppExecutionContext) {
      const previous=executionBindings.get(source);
      assertFrameBinding(previous,next);
      executionBindings.set(source,next);
      for(const listener of executionListeners.get(source) ?? []) listener(next);
    },
    /** The room the shell's own controls now cover over the frame. */
    setInsets(insets: AppFrameInsets) {
      frameInsets.set(source, insets);
      for (const listener of insetListeners.get(source) ?? []) listener(insets);
    },
    // Keep the last binding until the Window is collected: detached frames must never become live.
    dispose() { executionListeners.delete(source); insetListeners.delete(source); },
  };
}

export function registerBuildPreview(source: object, context: AppExecutionContext) {
  if(context.kind!=="build-test") throw new Error("A preview requires a build-test binding");
  return registerFrame(source,context);
}
/** Published application frames explicitly select live execution through this module. */
export function registerLiveFrame(source: object) {
  return registerFrame(source,{kind:"live"}).dispose;
}
function executionContext(source: object) {
  const context=executionBindings.get(source);
  if(!context) throw Object.assign(new Error("Frame execution context is not registered"),{code:"APP_HOST_FRAME_UNREGISTERED"});
  return context;
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
    executionContext,
    subscribeExecutionContext(source, listener) {
      executionContext(source);
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
    subscribeFrameInsets(source, listener) {
      executionContext(source);
      const listeners = insetListeners.get(source) ?? new Set();
      insetListeners.set(source, listeners);
      listeners.add(listener);
      listener(frameInsets.get(source) ?? NO_INSETS);
      return () => { listeners.delete(listener); };
    },
  };
}
