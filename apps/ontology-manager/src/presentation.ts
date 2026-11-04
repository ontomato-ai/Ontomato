import type { ManagerPresentation } from "@ontomato/ontology-manager";
import { brandProperties } from "@ontomato/design-tokens";
import { ossBrand } from "@ontomato/design-tokens/oss";

/** Manager component properties that are not brand colours (b6437c86). */
const managerProperties = {
  "--manager-relation-icon-color": "var(--el-color-primary-dark-2)",
  "--manager-relation-icon-background": "color-mix(in srgb, var(--el-color-primary) 14%, var(--el-bg-color))",
  "--manager-model-catalog-min-height": "auto",
  "--manager-modeling-panel-header-background": "var(--el-bg-color)",
  "--manager-filter-drawer-radius": "0",
};

/**
 * Open-source Manager presentation values, handed to the component by the profile. The colour variables and the node
 * palette are generated from the open-source brand source, the same source as the workbench theme; the rest are
 * component-specific properties.
 */
export const ossPresentation: ManagerPresentation = {
  themeProperties: {
    light: { ...brandProperties(ossBrand, "light"), ...managerProperties },
    dark: { ...brandProperties(ossBrand, "dark"), ...managerProperties },
  },
  nodePalette: ossBrand.dataviz,
  edgeLabel: { labelPlacement: "center", labelAutoRotate: false },
  maxFitZoom: 1,
  dataBrowserDescription: () => "Browse and inspect data records for the current object type.",
  compactDialogs: true,
};
