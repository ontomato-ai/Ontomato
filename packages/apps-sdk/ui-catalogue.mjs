import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  SDK_UI_COMPONENTS,
  SDK_UI_DIRECTIVES,
  SDK_UI_ENTRY_SPECIFIER,
  sdkThemeTokenCatalogueEntries,
  sdkThemeTokenReplacement,
  sdkUiComponentByImplExport,
  sdkUiComponentByImplTag,
} from "../contracts/src/sdk-ui-map.ts";

const require = createRequire(import.meta.url);

/** Concise descriptions for SDK primitives whose upstream web-types entry is absent. */
const FALLBACK_DESCRIPTIONS = {
  "sdk-auto-resizer": "Measures its container and passes live width and height into its default slot for virtualized views.",
  "sdk-collapse-transition": "Built-in height collapse transition wrapper for expandable content.",
  "sdk-select-v2": "Virtualized select input for large option lists.",
  "sdk-tree-select": "Select input backed by a hierarchical tree of options.",
};

const LEAK_PATTERN = /Element[\s-]?Plus|element-plus|--el-[a-z0-9-]+|\bel-[a-z][a-z0-9-]*\b|\bEl[A-Z][A-Za-z0-9]*\b/g;

function sanitizeText(raw) {
  if (raw == null) return "";
  let text = String(raw).replace(/\s+/g, " ").trim();
  text = text.replace(/Element[\s-]?Plus/gi, "Ontomato SDK");
  text = text.replace(/element-plus/gi, SDK_UI_ENTRY_SPECIFIER);
  text = text.replace(/--el-[a-z0-9-]+/g, (token) => sdkThemeTokenReplacement(token) ?? "SDK theme token");
  text = text.replace(/\bel-[a-z][a-z0-9-]*\b/g, (tag) => {
    const mapped = sdkUiComponentByImplTag(tag);
    if (mapped) return mapped.sdkTag;
    if (tag === "el-fade-in-linear") return "fade-in-linear";
    if (tag === "el-component") return "sdk-component";
    return tag.replace(/^el-/, "sdk-");
  });
  text = text.replace(/\bEl([A-Z][A-Za-z0-9]*)\b/g, (name, rest) => {
    const mapped = sdkUiComponentByImplExport(name);
    return mapped ? mapped.sdkExport : `Sdk${rest}`;
  });
  return text;
}

function formatType(type) {
  if (!type) return "unknown";
  if (typeof type === "string") return sanitizeText(type) || "unknown";
  if (Array.isArray(type)) {
    const parts = type.map((item) => (typeof item === "string" ? item : item?.name ?? "unknown")).filter(Boolean);
    return sanitizeText(parts.join(" | ")) || "unknown";
  }
  return sanitizeText(type?.name ?? "unknown") || "unknown";
}

/**
 * Build the SDK-owned `uiPrimitives`, `uiDirectives`, and `themeTokens` catalogue entries from the single mapping table
 * (`@ontomato/contracts/sdk-ui-map`) and the installed primitive metadata, with all third-party names removed.
 */
export function buildUiCatalogue() {
  const webTypes = JSON.parse(readFileSync(require.resolve("element-plus/web-types.json"), "utf8"));
  const byTag = new Map((webTypes.contributions?.html?.["vue-components"] ?? []).map((entry) => [entry.name, entry]));

  const uiPrimitives = SDK_UI_COMPONENTS.map((entry) => {
    const meta = byTag.get(entry.implTag);
    const description = sanitizeText(meta?.description) || FALLBACK_DESCRIPTIONS[entry.sdkTag];
    const props = (meta?.props ?? []).map((prop) => {
      const hasDefault = prop.default !== undefined && prop.default !== null && String(prop.default).trim() !== "";
      const defaultValue = hasDefault ? sanitizeText(String(prop.default)) : undefined;
      return {
        name: prop.name,
        type: formatType(prop.type ?? prop.value?.type),
        description: sanitizeText(prop.description),
        required: Boolean(prop.required),
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      };
    });
    const events = (meta?.js?.events ?? []).map((event) => ({
      name: event.name,
      type: formatType(event.type),
      description: sanitizeText(event.description),
    }));
    const slots = (meta?.slots ?? []).map((slot) => ({
      name: slot.name,
      type: formatType(slot.type),
      description: sanitizeText(slot.description),
    }));
    return {
      tag: entry.sdkTag,
      exportName: entry.sdkExport,
      module: SDK_UI_ENTRY_SPECIFIER,
      ...(description ? { description } : {}),
      props,
      events,
      slots,
    };
  });

  const uiDirectives = SDK_UI_DIRECTIVES.map((directive) => ({
    name: directive.sdkName,
    exportName: directive.sdkExport,
    module: SDK_UI_ENTRY_SPECIFIER,
    description: directive.description,
  }));

  const themeTokens = [...sdkThemeTokenCatalogueEntries()];

  const result = { uiPrimitives, uiDirectives, themeTokens };
  const serialized = JSON.stringify(result);
  const leaks = serialized.match(LEAK_PATTERN);
  if (leaks?.length) {
    throw new Error(`UI catalogue leaked third-party identifiers: ${[...new Set(leaks)].join(", ")}`);
  }
  return result;
}
