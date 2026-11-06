import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { app } from "./build.mjs";

// Maven silently skips absent resources, so check the image's source selection against its POM.
test("public staging includes every ontology contract resource declared by the core POM", () => {
  const source = app.contextTrees.find((tree) => tree.dest === "ontomato");
  const pom = readFileSync(resolve(source.root, "packages/data-engine-core/pom.xml"), "utf8");
  const contracts = [];
  for (const [resource] of pom.matchAll(/<resource>[\s\S]*?<\/resource>/g)) {
    if (!resource.includes("<targetPath>ontology-contracts</targetPath>")) continue;
    const directory = /<directory>([^<]+)<\/directory>/.exec(resource)?.[1];
    assert.ok(directory?.startsWith("../contracts"), `Unexpected contract resource directory: ${directory}`);
    for (const [, include] of resource.matchAll(/<include>([^<]+)<\/include>/g))
      contracts.push(resolve(source.root, "packages/data-engine-core", directory, include));
  }
  assert.ok(contracts.length > 0);
  for (const file of contracts) {
    assert.ok(existsSync(file), `Missing source contract: ${file}`);
    assert.ok(source.paths.some((path) => {
      const staged = resolve(source.root, path);
      return file === staged || file.startsWith(staged + "/");
    }), `Contract omitted from public build context: ${file}`);
  }
});
