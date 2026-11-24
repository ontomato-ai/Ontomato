import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SDK_UI_COMPONENTS } from "../contracts/src/sdk-ui-map.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const moduleId = "apps-sdk:element-components";

const SDK_UI_OVERRIDES = new Map([
  ["SdkDialog", { path: resolve(HERE, "src/ui/SdkDialog.ts").replace(/\\/g, "/"), exportName: "SdkDialog" }],
  ["SdkDrawer", { path: resolve(HERE, "src/ui/SdkDrawer.ts").replace(/\\/g, "/"), exportName: "SdkDrawer" }],
]);

/** Generate lazy loaders for the SDK UI primitives declared in the single mapping table. */
export function elementComponents() {
  return {
    name: "apps-sdk-element-components",
    resolveId(id) {
      if (id === moduleId) return "\0" + id;
    },
    load(id) {
      if (id !== "\0" + moduleId) return;
      const loaders = SDK_UI_COMPONENTS.map(({ sdkExport, implExport, implSubpath }) => {
        const override = SDK_UI_OVERRIDES.get(sdkExport);
        if (override) {
          return `  ${sdkExport}: () => import(${JSON.stringify(override.path)}).then(module => module.${override.exportName})`;
        }
        const path = `element-plus/es/components/${implSubpath}/index.mjs`;
        return `  ${sdkExport}: () => import(${JSON.stringify(path)}).then(module => module.${implExport})`;
      });
      return `export default {\n${loaders.join(",\n")}\n};`;
    },
  };
}
