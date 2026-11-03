import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { PlatformAccess, PlatformNavigation } from "./navigation";
import type { PlatformApi } from "./api";
import type { BusinessConfigProps } from "./config/business-config";

export type PlatformTheme = "light" | "dark";

/** The page's theme and language; the Ontology Manager page owns them and shares them with the platform area. */
export interface PlatformPreferences {
  /** Supported locales; a single entry means no language control. */
  readonly locales: readonly string[];
  readonly locale: Ref<string>;
  setLocale(locale: string): void;
  readonly theme: Ref<PlatformTheme>;
  setTheme(theme: PlatformTheme): void;
}

/** A header tab that only runs an action (e.g. the signed jump to data governance). */
export interface PlatformAction {
  key: string;
  titleKey: string;
  select(): void;
}

/** What the platform layout and pages read from the host for one page load. */
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
  /** Header action tabs, after the title. */
  actions: readonly PlatformAction[];
  /** Reduced layout (header only), e.g. on the license page while the license is invalid. */
  navigationHidden: ComputedRef<boolean>;
  /** Leave the platform area for the Ontology Manager workspace. */
  openWorkspace(): void;
  /** This edition's values for the system configuration page (backend languages, data adapter card layout). */
  systemConfig: BusinessConfigProps;
  /** Punctuation between a message and its detail (`：` for Chinese-style text, `:` otherwise). */
  separators: { detail: string };
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
