// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { findBrandDeclarations } from "..";

/*
 * Every brand colour of the open-source edition comes from src/oss.ts through the generator in this package. No
 * stylesheet, component or presentation file in the public apps and packages may declare a generated brand variable
 * again (that is how the second hand-kept copy of theme.css and presentation.ts would come back).
 */
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const SKIPPED = new Set(["node_modules", "dist", "public", "__tests__", "target"]);
const BRAND_SOURCE = "packages/design-tokens/src";

function sources(directory: string, found: Record<string, string> = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(repository, path);
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name) && relativePath !== BRAND_SOURCE) sources(path, found);
    } else if (/\.(css|vue|ts)$/.test(entry.name)) found[relativePath] = readFileSync(path, "utf8");
  }
  return found;
}

/* Known page-level overrides that still hard-code brand variables; the page work removes them. */
const PENDING = new Set([
  "packages/workbench-ui/src/features/diagnosis/components/layout/OperationsFeatures.vue: --el-text-color-secondary",
  "packages/workbench-ui/src/features/diagnosis/components/layout/OperationsFeatures.vue: --el-text-color-placeholder",
]);

it("no public source declares a generated brand variable outside the brand source", () => {
  const files = { ...sources(join(repository, "apps")), ...sources(join(repository, "packages")) };
  expect(Object.keys(files)).toContain("apps/ontology-manager/src/presentation.ts");
  expect(Object.keys(files)).toContain("packages/ontology-manager/src/theme.css");
  expect(findBrandDeclarations(files).filter((found) => !PENDING.has(found))).toEqual([]);
});
