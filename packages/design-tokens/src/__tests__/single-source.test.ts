// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { findBrandDeclarations } from "..";

/*
 * Every brand colour of the open-source edition comes from src/oss.ts through the generator in this package. No
 * stylesheet, component or presentation file in the public apps and packages may declare a generated brand variable
 * again (that is how the second hand-kept copy of theme.css and presentation.ts would come back).
 */
const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const BRAND_SOURCE = "packages/design-tokens/src";

/** Tracked sources only: local build output (for example a development data-engine's static files) is not source. */
function sources(directory: string) {
  const paths = execFileSync("git", ["ls-files", "-z", "--", directory], { cwd: repository, encoding: "utf8" })
    .split("\0")
    .filter((path) => /\.(css|vue|ts)$/.test(path) && !path.startsWith(`${BRAND_SOURCE}/`) && !path.includes("/__tests__/"));
  return Object.fromEntries(paths.map((path) => [path, readFileSync(join(repository, path), "utf8")]));
}

it("no public source declares a generated brand variable outside the brand source", () => {
  const files = { ...sources("apps"), ...sources("packages") };
  expect(Object.keys(files)).toContain("apps/workbench/web/src/manager/presentation.ts");
  expect(Object.keys(files)).toContain("packages/ontology-manager/src/theme.css");
  expect(findBrandDeclarations(files)).toEqual([]);
});
