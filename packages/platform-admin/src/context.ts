import { inject, type ComputedRef, type InjectionKey, type Ref } from "vue";
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
  /**
   * Why the platform shows no application at all: the edition's licence is not in force, or the account holds no page.
   * The host decides, because it owns licences and permissions; a shell only renders the answer.
   */
  blocked?: ComputedRef<{ reason: "licence" | "no-pages"; messageKey: string } | null>;
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

