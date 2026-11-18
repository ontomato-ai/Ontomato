declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** The product's edition module, bound by `build.mjs`. */
declare module "apps-sdk:edition" {
  import type { SdkEdition } from "@ontomato/apps-sdk";
  const edition: SdkEdition;
  export default edition;
}

declare module "apps-sdk:element-components" {
  const loaders: Record<string, () => Promise<import("vue").Component>>;
  export default loaders;
}

declare module "apps-sdk:panel-appearance" {
  export const brand: import("@ontomato/apps-sdk").SdkEdition["brand"];
  export const defaultLocale: string;
  export const locales: Record<string, () => Promise<import("./context").AppLocale>>;
}
