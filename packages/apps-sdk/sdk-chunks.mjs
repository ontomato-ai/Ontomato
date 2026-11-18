import { join } from "node:path";
import { normalizePath } from "vite";

const element = "/node_modules/element-plus/es/";
const componentIndex = /^components\/([^/]+)\/index\.mjs$/;
const families = [
  ["element-summary", ["card", "empty", "skeleton"]],
  ["element-form", ["button", "form", "input", "select"]],
  ["element-layout", ["affix", "anchor", "backtop", "breadcrumb", "collapse", "container", "divider", "menu",
    "page-header", "row", "col", "scrollbar", "space", "splitter", "steps", "tabs"]],
  ["element-data", ["auto-resizer", "descriptions", "pagination", "table", "table-v2", "timeline", "tree",
    "tree-select", "tree-v2"]],
  ["element-pickers", ["calendar", "cascader", "cascader-panel", "color-picker", "color-picker-panel", "date-picker",
    "date-picker-panel", "time-picker", "time-select", "transfer", "upload"]],
];

/** A small family owns the static modules it needs. Larger families reuse those modules through the same exports. */
export function sdkChunks(root) {
  const assignments = new Map();
  return (id, { getModuleIds, getModuleInfo }) => {
    if (assignments.size === 0) {
      const claim = (name, ...roots) => {
        const visit = (module) => {
          const info = getModuleInfo(module);
          if (assignments.has(module) || info.isExternal) return;
          assignments.set(module, name);
          for (const dependency of info.importedIds) visit(dependency);
        };
        for (const module of roots) visit(module);
      };
      const vueEntry = normalizePath(join(root, "src/entries/vue.ts"));
      claim("vue-runtime", ...getModuleInfo(vueEntry).importedIds);

      const elementPaths = new Map([...getModuleIds()].filter(module => module.includes(element)).map(module =>
        [module.split(element)[1], module],
      ));
      claim("element-context", elementPaths.get("components/config-provider/src/hooks/use-global-config.mjs"));
      for (const [name, components] of families) {
        const roots = [...elementPaths].filter(([path]) => components.includes(componentIndex.exec(path)?.[1]));
        claim(name, ...roots.map(([, module]) => module));
      }
      claim("element-extras", elementPaths.get("index.mjs"));
    }
    return assignments.get(id);
  };
}
