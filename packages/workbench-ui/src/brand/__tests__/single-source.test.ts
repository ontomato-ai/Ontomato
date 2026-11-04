import { expect, it } from "vitest";
import { findBrandDeclarations } from "..";

/*
 * Every brand colour of the open-source edition comes from src/brand/oss.ts through the generator in src/brand. No
 * stylesheet, component or presentation file in the public apps and packages may declare a generated brand variable
 * again (that is how the second hand-kept copy of theme.css and presentation.ts would come back).
 */
const sources = import.meta.glob(
  [
    "../../../../../{apps,packages}/**/*.{css,vue,ts}",
    "!../../../../../**/node_modules/**",
    "!../../../../../**/dist/**",
    "!../../../../../**/public/**",
    "!../../../../../**/__tests__/**",
    "!../../../../../packages/workbench-ui/src/brand/**",
  ],
  { query: "?raw", import: "default", eager: true }
) as Record<string, string>;

/* Known page-level overrides that still hard-code brand variables; the page work removes them. */
const PENDING = new Set([
  "packages/workbench-ui/src/features/diagnosis/components/layout/OperationsFeatures.vue: --el-text-color-secondary",
  "packages/workbench-ui/src/features/diagnosis/components/layout/OperationsFeatures.vue: --el-text-color-placeholder",
]);

/** Glob keys are relative to this file; report repository paths. */
function repositoryPath(key: string) {
  const parts = ["packages", "workbench-ui", "src", "brand", "__tests__"];
  for (const segment of key.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

it("no public source declares a generated brand variable outside the brand source", () => {
  const files = Object.fromEntries(Object.entries(sources).map(([key, text]) => [repositoryPath(key), text]));
  expect(Object.keys(files).some((path) => path.startsWith("apps/ontology-manager/src/"))).toBe(true);
  expect(Object.keys(files).some((path) => path.startsWith("packages/ontology-manager/src/"))).toBe(true);
  expect(findBrandDeclarations(files).filter((found) => !PENDING.has(found))).toEqual([]);
});
