import {
  inject,
  onBeforeUnmount,
  shallowRef,
  watchEffect,
  type App,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import type { PlatformAccess, PlatformLink, PlatformNavigation } from "./navigation";
import type { PlatformApi } from "./api";
import type { BusinessConfigProps } from "./config/business-config";

export type PlatformTheme = "light" | "dark";

/** The page's theme and language, owned by the Ontology Service page; the layout's controls change them. */
export interface PlatformPreferences {
  /** Supported locales; a single entry means no language control. */
  readonly locales: readonly string[];
  readonly locale: Ref<string>;
  setLocale(locale: string): void;
  readonly theme: Ref<PlatformTheme>;
  setTheme(theme: PlatformTheme): void;
}

/** What the service layout and the platform pages read from the host for one page load. */
export interface PlatformPageHost<Api extends PlatformApi = PlatformApi> {
  access: PlatformAccess;
  api: Api;
  preferences: PlatformPreferences;
  /**
   * Navigation as displayed: the same pages and permissions the router guards, with group and page titles the host may
   * resolve (the enterprise edition takes them from the registered application catalog).
   */
  navigation: ComputedRef<PlatformNavigation>;
  /** Signed-in account display name and sign-out; null in editions without sign-in. */
  account: { readonly userName: string; signOut(): void } | null;
  /** Links to the other applications at the top of the sidebar, in display order. */
  links: readonly PlatformLink[];
  /** Reduced layout (no navigation), e.g. on the license page while the license is invalid. */
  navigationHidden: ComputedRef<boolean>;
  /** This edition's values for the system configuration page (backend languages, data adapter card layout). */
  systemConfig: BusinessConfigProps;
  /** Punctuation between a message and its detail (`：` for Chinese-style text, `:` otherwise). */
  separators: { detail: string };
  /**
   * Screens an edition supplies in place of a page's tab: the tab's address to the component that draws it (the licence
   * page is the enterprise edition's). A tab without one draws nothing.
   */
  tabPanels?: Readonly<Record<string, Component>>;
}

export const platformHostKey: InjectionKey<PlatformPageHost> = Symbol("platform-page-host");

/** Provide map for mounting a platform page outside the platform app (component tests). */
export function providePlatformHost(host: PlatformPageHost<any>) {
  return { [platformHostKey as symbol]: host };
}

export function usePlatformHost<Api extends PlatformApi = PlatformApi>(): PlatformPageHost<Api> {
  const host = inject(platformHostKey);
  if (!host) throw new Error("Platform pages must be mounted inside the platform app");
  return host as PlatformPageHost<Api>;
}


/**
 * What a page that holds one draft writes for the layout's page header: the unsaved marker and the Save / Discard
 * actions. A page provides it while it is shown; the layout draws it at the end of the 48px header it draws itself.
 */
export interface PlatformPageActions {
  readonly dirty: boolean;
  readonly saving: boolean;
  save(): void;
  discard(): void;
}

export const pageActionsKey: InjectionKey<Ref<PlatformPageActions | null>> = Symbol("platform-page-actions");

/**
 * Provided on the app — the app is assembled before any component's setup runs, where a plain `provide` has no
 * effect — written by the shown page and read by the layout.
 */
export function providePageActions(app: App): Ref<PlatformPageActions | null> {
  const actions = shallowRef<PlatformPageActions | null>(null);
  app.provide(pageActionsKey, actions);
  return actions;
}

/**
 * Shows one page's header actions in the layout for as long as the calling component is mounted, and clears them on
 * unmount so the next page starts without them. `actions` is a getter: a page with several tabs hands them over on the
 * tab that has them, and the flags are read through it, so they stay live.
 */
export function usePageActions(actions: () => PlatformPageActions | null) {
  const target = inject(pageActionsKey, null);
  if (!target) return;
  watchEffect(() => (target.value = actions()));
  onBeforeUnmount(() => {
    target.value = null;
  });
}

export function usePageActionsOf(): Readonly<Ref<PlatformPageActions | null>> {
  return inject(pageActionsKey, shallowRef<PlatformPageActions | null>(null));
}
