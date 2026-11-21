import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageComponents } from "./package-components.mjs";

/*
 * A third party's package describes its components as the SDK describes its own (product-layer standard, component
 * packages): the author declares each component's meaning with defineComponentMeta, and the tool reads its props, events
 * and slots from the Vue source with the SDK's extractor and writes the package's components.json under the package's
 * name — the file the platform reads when it installs the package, before running any of its code.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

test("writes a package's components.json from its declarations and its Vue sources", async (t) => {
  // Inside the SDK's folder, so the fixture resolves Vue's types as a package's own project would.
  const root = mkdtempSync(join(HERE, ".package-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  file("package.json", JSON.stringify({
    name: "@example/charts", version: "1.0.0", author: "Example",
    ontomato: { entries: { "@example/charts": "dist/index.mjs" }, components: "components.json", styles: ["dist/charts.css"] },
  }));
  file("tsconfig.json", JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, jsx: "preserve", allowImportingTsExtensions: true, noEmit: true },
    include: ["src/**/*.ts", "src/**/*.vue"],
  }));
  file("src/Gauge.vue", [
    '<script setup lang="ts">',
    "defineProps<{",
    "  /** The value the gauge points at, from 0 to 100. */",
    "  value: number;",
    "  /** The text under the gauge. */",
    "  caption?: string;",
    "}>();",
    "defineEmits<{",
    "  /** The reader chose a value on the gauge. */",
    "  pick: [value: number];",
    "}>();",
    "</script>",
    "<template><div class=\"gauge\">{{ value }} {{ caption }}<slot name=\"legend\"></slot></div></template>",
  ].join("\n"));
  file("src/index.ts", 'export { default as Gauge } from "./Gauge.vue";\n');
  file("src/catalogue.ts", [
    `import { defineComponentMeta } from ${JSON.stringify(join(HERE, "src/components.ts"))};`,
    "export const components = [",
    "  defineComponentMeta({",
    '    componentId: "Gauge", module: "@example/charts", exportName: "Gauge", role: "presentation",',
    '    meaning: "Draws one value from 0 to 100 as a gauge.",',
    "  }),",
    "];",
  ].join("\n"));

  const { out, components } = await packageComponents({
    root, catalogue: "src/catalogue.ts", tsconfig: join(root, "tsconfig.json"), sources: { "@example/charts": "src/index.ts" },
  });
  assert.equal(out, join(root, "components.json"));
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), components);
  const [gauge] = components;
  assert.equal(gauge.componentId, "@example/charts:Gauge");
  assert.deepEqual(gauge.ports.props.map(({ name, required }) => [name, required]), [["value", true], ["caption", false]]);
  assert.deepEqual(gauge.ports.events.map(({ name }) => name), ["pick"]);
  assert.deepEqual(gauge.ports.slots.map(({ name }) => name), ["legend"]);
  assert.deepEqual(gauge.config.map(({ name }) => name), ["value", "caption"]);
});

test("refuses a source for an entry the package does not declare", async (t) => {
  const root = mkdtempSync(join(HERE, ".package-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@example/charts", version: "1.0.0", author: "Example",
    ontomato: { entries: { "@example/charts": "dist/index.mjs" }, components: "components.json" },
  }));
  await assert.rejects(() => packageComponents({ root, catalogue: "src/catalogue.ts", tsconfig: join(root, "tsconfig.json"), sources: { "@example/other": "src/index.ts" } }),
    /--source @example\/other: the package's ontomato.entries declare @example\/charts/);
});
