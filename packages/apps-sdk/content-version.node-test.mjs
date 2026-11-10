import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeSdk, VERSION_PLACEHOLDER } from "./content-version.mjs";

test("SDK addresses follow output content, independent of surrounding product changes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sdk-content-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function output(name, changed = "", release = false) {
    const out = join(root, name);
    const stage = join(out, VERSION_PLACEHOLDER);
    mkdirSync(join(stage, "docs"), { recursive: true });
    writeFileSync(join(stage, "sdk.js"), "export const sdk = 1;" + changed);
    writeFileSync(join(stage, "docs/index.md"), `/apps-sdk/${VERSION_PLACEHOLDER}/sdk.js`);
    return { out, version: finalizeSdk(out, "1.0.0", release) };
  }
  const first = output("first");
  writeFileSync(join(root, "unrelated-product-code.js"), "new product code");
  assert.equal(output("second").version, first.version);
  assert.notEqual(output("changed", "export const next = 2;").version, first.version);
  assert.equal(output("release", "", true).version, "1.0.0");
  assert.equal(readFileSync(join(first.out, first.version, "docs/index.md"), "utf8"), `/apps-sdk/${first.version}/sdk.js`);
});
