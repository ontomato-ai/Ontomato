import { BUILD_TEST_SDK_CAPABILITY } from "../contracts/src/build-tests.ts";
// Builds one product's apps SDK: `node build.mjs <edition module> <output root>`. The output root then holds exactly
// current.json and one version directory with the browser modules, the stylesheet, the docs, the examples and the Node
// module a check of panel sources runs (`node/panel-check.mjs`) of that version. The source
// facts come from the image builder in APPS_SDK_BUILD (scripts/workbench/build-images.mjs).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { build, normalizePath } from "vite";
import { finalizeSdk, VERSION_PLACEHOLDER } from "./content-version.mjs";
import { elementComponents } from "./element-components.mjs";
import { panelAppearance } from "./panel-appearance.mjs";
import { sdkChunks } from "./sdk-chunks.mjs";
import { catalogueMarkdown, checkCatalogue, componentMetadata, componentPorts, referenceMarkdown } from "./reference.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The public modules: the import-map specifier an app uses, the file it maps to, and the entry source. */
const ENTRIES = [
  { specifier: "vue", file: "vue.js", source: "src/entries/vue.ts" },
  { specifier: "element-plus", file: "element-plus.js", source: "src/entries/element-plus.ts" },
  { specifier: "echarts", file: "echarts.js", source: "src/entries/echarts.js" },
  { specifier: "@ontomato/sdk", file: "sdk.js", source: "src/entries/sdk.ts" },
  { specifier: "@ontomato/sdk/chart", file: "chart.js", source: "src/entries/chart.ts" },
  { specifier: "@ontomato/sdk/markdown", file: "markdown.js", source: "src/entries/markdown.ts" },
  { specifier: "@ontomato/sdk/form", file: "form.js", source: "src/entries/form.ts" },
  { specifier: "@ontomato/sdk/code", file: "code.js", source: "src/entries/code.ts" },
  { specifier: "@ontomato/sdk/preview", file: "preview.js", source: "src/entries/preview.ts" },
  { specifier: "@ontomato/sdk/chat", file: "chat.js", source: "src/entries/chat.ts" },
  { specifier: "@ontomato/sdk/panel", file: "panel.js", source: "src/entries/panel.ts" },
  { specifier: "@ontomato/sdk/base", file: "base.js", source: "src/entries/base.ts" },
  { specifier: "@ontomato/sdk/graph", file: "graph.js", source: "src/entries/graph.ts" },
];
const STYLESHEET = "styles/sdk.css";
/** The Node module of the parsers and schemas a check of no-code panel sources runs (the contracts' `panel-check.ts`). */
const CHECK = "node/panel-check.mjs";
/** What a check of no-code panel sources takes from it, by these names. */
const CHECK_EXPORTS = [
  "directPanelDefinitionContentSchema", "directPanelManifestSchema", "directProjectionInputSchema",
  "registerDirectPanelRequestSchema", "registerDirectProjectionRequestSchema", "parsePanelLayout", "PanelLayoutError",
];
/** The third-party libraries apps program against directly; their versions are part of an SDK version's contract. */
const LIBRARIES = ["vue", "element-plus", "echarts"];

function readFacts(text) {
  const facts = JSON.parse(text || "null");
  if (typeof facts?.product !== "string" || typeof facts.release !== "boolean")
    throw new Error("APPS_SDK_BUILD must be {product, release} from the image builder");
  return facts;
}

/** Every module, chunk and example shares one Vue: a second runtime would split reactivity and component identity. */
function oneVueRuntime() {
  return {
    name: "apps-sdk-one-vue-runtime",
    generateBundle(_options, bundle) {
      const runtimes = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          const match = /^(.*\/@vue\/runtime-core)\//.exec(id);
          if (match) runtimes.add(match[1]);
        }
      }
      if (runtimes.size !== 1) this.error(`expected one Vue runtime in the SDK, found ${[...runtimes].join(", ") || "none"}`);
    },
  };
}

function head(version) {
  const base = `/apps-sdk/${version}`;
  const imports = Object.fromEntries(ENTRIES.map((entry) => [entry.specifier, `${base}/${entry.file}`]));
  return [
    `<link rel="stylesheet" href="${base}/${STYLESHEET}">`,
    `<script type="importmap">`,
    JSON.stringify({ imports }, null, 2),
    `</script>`,
  ].join("\n");
}

function render(text, version) {
  return text.replaceAll("{{head}}", head(version)).replaceAll("{{version}}", version);
}

const libraryVersion = (name) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;

/**
 * The contracts' panel check as one Node module with its dependencies inside, so a command line checks a panel's sources
 * with this version's own parsers and schemas, without the platform's sources. It is loaded once here, as a command line
 * loads it.
 */
async function buildCheck(outDir) {
  await build({
    configFile: false,
    root: HERE,
    logLevel: "warn",
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: join(HERE, "../contracts/src/panel-check.ts"),
      outDir: join(outDir, dirname(CHECK)),
      emptyOutDir: false,
      target: "node22",
      minify: false,
      reportCompressedSize: false,
      rollupOptions: { output: { format: "es", entryFileNames: CHECK.slice(dirname(CHECK).length + 1), inlineDynamicImports: true } },
    },
  });
  const check = await import(pathToFileURL(join(outDir, CHECK)).href);
  const missing = CHECK_EXPORTS.filter((name) => !(name in check));
  if (missing.length) throw new Error(`${CHECK} does not export ${missing.join(", ")}`);
}

async function main() {
  const [editionArg, outArg] = process.argv.slice(2);
  if (!editionArg || !outArg) throw new Error("usage: node build.mjs <edition module> <output root>");
  const facts = readFacts(process.env.APPS_SDK_BUILD);
  const base = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
  const version = VERSION_PLACEHOLDER;
  const outRoot = resolve(outArg);
  const outDir = join(outRoot, version);
  rmSync(outRoot, { recursive: true, force: true });

  await build({
    configFile: false,
    root: HERE,
    base: "./",
    plugins: [vue(), elementComponents(), await panelAppearance(resolve(editionArg)), oneVueRuntime()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
      alias: [
        // The full build: apps write their templates in HTML, so the browser compiles them.
        { find: /^vue$/, replacement: require.resolve("vue/dist/vue.esm-bundler.js") },
        { find: /^apps-sdk:edition$/, replacement: resolve(editionArg) },
      ],
      dedupe: ["element-plus", "echarts", "vue-i18n"],
    },
    build: {
      outDir,
      emptyOutDir: true,
      reportCompressedSize: false,
      cssCodeSplit: false,
      // Vite starts a selected chunk and its static dependencies together, which matters in an HTTP/1.1 frame.
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: Object.fromEntries(ENTRIES.map((entry) => [entry.file.replace(/\.js$/, ""), join(HERE, entry.source)])),
        // These are browser-ready modules. Use Vite's full JS minification and keep the published entry exports.
        preserveEntrySignatures: "strict",
        treeshake: {
          // The Manager API also imports this factory for its own pages. The SDK needs its schemas only when it calls the factory.
          moduleSideEffects: (id) => id !== normalizePath(resolve(HERE, "../ontology-manager/src/clients/products.ts")),
        },
        output: {
          format: "es",
          entryFileNames: "[name].js",
          manualChunks: sdkChunks(HERE),
          onlyExplicitManualChunks: true,
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (asset) => (asset.name === "style.css" ? STYLESHEET : "assets/[name]-[hash][extname]"),
        },
      },
    },
  });

  await buildCheck(outDir);
  mkdirSync(join(outDir, "docs"), { recursive: true });
  writeFileSync(join(outDir, "docs/index.md"), render(readFileSync(join(HERE, "resources/docs/index.md"), "utf8"), version));
  const components = componentMetadata({ tsconfig: join(HERE, "tsconfig.json"), source: join(HERE, "src/catalogue.ts") });
  const publicEntries = ENTRIES.filter((entry) => entry.specifier.startsWith("@ontomato/"));
  checkCatalogue(publicEntries, components, HERE, join(HERE, "tsconfig.json"));
  // Each component's meaning is its declaration's; its ports are read from its source, as the reference reads them.
  const ports = componentPorts({ root: HERE, tsconfig: join(HERE, "tsconfig.json"), entries: publicEntries });
  writeFileSync(join(outDir, "components.json"), `${JSON.stringify({
    version,
    components: components.map(({ metadata }) => ({ ...metadata, ports: ports.get(`${metadata.module}#${metadata.exportName}`) })),
  }, null, 2)}\n`);
  writeFileSync(join(outDir, "docs/components.md"), render(catalogueMarkdown(version, components), version));
  writeFileSync(join(outDir, "docs/reference.md"), [
    `# @ontomato/sdk ${version}: reference`,
    "",
    "Generated from the sources of this version. Start with [index.md](index.md).",
    "",
    referenceMarkdown({ root: HERE, tsconfig: join(HERE, "tsconfig.json"), entries: ENTRIES.filter((entry) => entry.specifier.startsWith("@ontomato/")) }),
  ].join("\n"));
  // Element Plus's own metadata of the installed version: every component's props, events and slots.
  cpSync(require.resolve("element-plus/web-types.json"), join(outDir, "docs/element-plus.web-types.json"));
  mkdirSync(join(outDir, "examples"));
  for (const name of readdirSync(join(HERE, "resources/examples")))
    writeFileSync(join(outDir, "examples", name), render(readFileSync(join(HERE, "resources/examples", name), "utf8"), version));

  writeFileSync(join(outDir, "sdk.json"), `${JSON.stringify({
    version,
    product: facts.product,
    executionContext: BUILD_TEST_SDK_CAPABILITY,
    hostTransport: 1,
    messageBridge: 2,
    entries: Object.fromEntries(ENTRIES.map((entry) => [entry.specifier, entry.file])),
    stylesheet: STYLESHEET,
    components: "components.json",
    check: CHECK,
    libraries: Object.fromEntries(LIBRARIES.map((name) => [name, libraryVersion(name)])),
    docs: "docs/index.md",
  }, null, 2)}\n`);
  const finalVersion = finalizeSdk(outRoot, base, facts.release);
  console.log(`[apps-sdk] ${facts.product} ${finalVersion} -> ${outRoot}`);
}

main().catch((error) => {
  console.error(`[apps-sdk] ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
