import type { BrandSource } from "@ontomato/design-tokens";
import type { ManagerMessages } from "@ontomato/ontology-manager/i18n";
import type { WorkbenchLanguage } from "@ontomato/workbench-ui/i18n";

/**
 * What one product puts into its build of the SDK, taken from the modules its platform starts with: its brand, its
 * languages and its words. The SDK code is the same in both products; `build.mjs` binds the product's module to
 * `apps-sdk:edition`.
 */
export interface SdkEdition {
  brand: BrandSource;
  /** The platform's language profile: supported locales, the workbench words and Element Plus's locales. */
  language: WorkbenchLanguage;
  /** The Manager words per supported locale; the request layer's messages come from here. */
  managerMessages: Readonly<Record<string, ManagerMessages>>;
}
