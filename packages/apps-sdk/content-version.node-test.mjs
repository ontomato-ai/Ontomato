import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
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

test("compressed siblings are delivery artifacts and do not change the content-addressed version", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sdk-compression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staged = join(root, VERSION_PLACEHOLDER);
  const source = {
    "sdk.js": "export const sdk = 1;\n",
    "styles/sdk.css": "body { color: red; }\n",
    "sdk.json": JSON.stringify({ version: VERSION_PLACEHOLDER }) + "\n",
    "docs/index.md": `# SDK ${VERSION_PLACEHOLDER}\n`,
    "examples/basic.html": `<script src="/apps-sdk/${VERSION_PLACEHOLDER}/sdk.js"></script>\n`,
    "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
  for (const [name, bytes] of Object.entries(source)) {
    mkdirSync(dirname(join(staged, name)), { recursive: true });
    writeFileSync(join(staged, name), bytes);
  }

  // The version is the hash of the staged output before placeholder replacement and before compression.
  const hash = createHash("sha256");
  for (const name of Object.keys(source).sort()) {
    const bytes = source[name];
    hash.update(JSON.stringify([name, Buffer.byteLength(bytes)]) + "\n").update(bytes);
  }
  const version = finalizeSdk(root, "1.0.0", false);
  assert.equal(version, `1.0.0-dev.${hash.digest("hex")}`);

  for (const name of ["sdk.js", "styles/sdk.css", "sdk.json", "docs/index.md", "examples/basic.html"]) {
    const final = readFileSync(join(root, version, name));
    assert.deepEqual(brotliDecompressSync(readFileSync(join(root, version, `${name}.br`))), final);
    assert.deepEqual(gunzipSync(readFileSync(join(root, version, `${name}.gz`))), final);
  }
  assert.equal(existsSync(join(root, version, "assets/logo.png.br")), false);
  assert.equal(existsSync(join(root, version, "assets/logo.png.gz")), false);
});

test("the generated component catalogue carries the SDK version named by current.json", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sdk-catalogue-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staged = join(root, VERSION_PLACEHOLDER);
  mkdirSync(staged);
  const components = [{ componentId: "ObjectList", meaning: "Lists the bound objects." }];
  writeFileSync(join(staged, "components.json"), JSON.stringify({ version: VERSION_PLACEHOLDER, components }) + "\n");

  const { version: base } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  finalizeSdk(root, base, false);

  const { version } = JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
  const catalogue = JSON.parse(readFileSync(join(root, version, "components.json"), "utf8"));
  assert.deepEqual(catalogue, { version, components });
});
