// Builds one product's apps SDK: `node build.mjs <edition module> <output root>`. The output root then holds exactly
// current.json and one version directory with the browser modules, the stylesheet, the docs and the examples of that version. The source
// facts come from the image builder in APPS_SDK_BUILD (scripts/workbench/build-images.mjs).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { build } from "vite";
import { finalizeSdk, VERSION_PLACEHOLDER } from "./content-version.mjs";
import { referenceMarkdown } from "./reference.mjs";

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
];
const STYLESHEET = "styles/sdk.css";
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
    plugins: [vue(), oneVueRuntime()],
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
      lib: {
        entry: Object.fromEntries(ENTRIES.map((entry) => [entry.file.replace(/\.js$/, ""), join(HERE, entry.source)])),
        formats: ["es"],
        fileName: (_format, name) => `${name}.js`,
      },
      rollupOptions: {
        output: {
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (asset) => (asset.name === "style.css" ? STYLESHEET : "assets/[name]-[hash][extname]"),
        },
      },
    },
  });

  mkdirSync(join(outDir, "docs"), { recursive: true });
  writeFileSync(join(outDir, "docs/index.md"), render(readFileSync(join(HERE, "resources/docs/index.md"), "utf8"), version));
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
    entries: Object.fromEntries(ENTRIES.map((entry) => [entry.specifier, entry.file])),
    stylesheet: STYLESHEET,
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
