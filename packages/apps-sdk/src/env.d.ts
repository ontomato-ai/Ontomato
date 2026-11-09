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
