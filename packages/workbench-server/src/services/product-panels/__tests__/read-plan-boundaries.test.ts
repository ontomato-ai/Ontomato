import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/*
 * The read plan and operation availability are the platform's: business modules register their reads and declare their
 * operations, and these files only run what is registered. They import no business directory and no business file of
 * product-panels; the two registration lists (registered-data-reads.ts, server-operations.ts) are where business
 * modules are named.
 */
const productPanels = path.resolve(__dirname, "..");
const planFiles = ["registered-read-plan.ts", "registered-operation-reads.ts", "operation-availability.ts", "registered-data-read.ts"];
const platformFiles = new Set([
  "application-use", "data-reads", "direct-operations", "java-panel-reads", "member-path", "operation-availability",
  "operation-bindings", "read-directive", "registered-data-read", "registered-data-reads",
  "registered-operation-reads", "server-operations",
]);

function imports(file: string) {
  const source = readFileSync(path.join(productPanels, file), "utf8");
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/gu)].map(([, specifier]) => specifier!);
}

it.each(planFiles)("%s imports only platform modules", file => {
  const business = imports(file).filter(specifier => {
    if (!specifier.startsWith(".")) return false;
    if (specifier.startsWith("./")) return !platformFiles.has(specifier.slice(2));
    // Shared infrastructure above services, and the platform's own governance boundary.
    return !specifier.startsWith("../../") && !specifier.startsWith("../product-governance/");
  });
  expect(business).toEqual([]);
});
