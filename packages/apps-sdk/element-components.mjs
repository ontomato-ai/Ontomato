import { SDK_UI_COMPONENTS } from "../contracts/src/sdk-ui-map.ts";
const moduleId = "apps-sdk:element-components";

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
        const path = `element-plus/es/components/${implSubpath}/index.mjs`;
        return `  ${sdkExport}: () => import(${JSON.stringify(path)}).then(module => module.${implExport})`;
      });
      return `export default {\n${loaders.join(",\n")}\n};`;
    },
  };
}
