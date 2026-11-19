import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * One panel directory supplies its declaration, translations, projections and source files.
 * The entry exposes candidate workspace imports and create material for projections and panels.
 */
export function createPanelMaterial(entryUrl, { id, name, description }) {
  const readModule = createRequire(entryUrl);
  const { default: manifest } = readModule("./declaration.mjs");
  const { default: messages } = readModule("./messages.mjs");
  const { default: projections } = readModule("./projections.mjs");
  const text = (file) => readFileSync(new URL(file, entryUrl), "utf8");

  function panelContent() {
    return {
      html: text("panel.html"),
      module: text("panel.mjs"),
      ...(existsSync(new URL("recipes.md", entryUrl)) ? { recipes: text("recipes.md") } : {}),
      messages,
    };
  }

  function candidateFiles(sdkVersion) {
    const { html, module, recipes } = panelContent();
    const file = (path, content) => ({ path, content, encoding: "utf8" });
    return [
      file("panel.html", html),
      file("panel.mjs", module),
      ...(recipes === undefined ? [] : [file("recipes.md", recipes)]),
      file("panel.json", `${JSON.stringify({ manifest, sdkVersion, content: { messages } }, null, 2)}\n`),
    ];
  }

  function panelInput(sdkVersion) {
    return { name, description, visibility: "domain", content: panelContent(), manifest, sdkVersion };
  }

  function projectionMaterial() {
    return { projections: projections.map(({ id, input }) => ({ id, mode: "create", input })) };
  }

  function panelMaterial(sdkVersion) {
    return { panels: [{ id, mode: "create", input: panelInput(sdkVersion) }] };
  }

  function runCli() {
    if (process.argv[1] !== fileURLToPath(entryUrl)) return;
    const [command, ...args] = process.argv.slice(2);
    if (command === "projections") {
      console.log(JSON.stringify(projectionMaterial(), null, 2));
      return;
    }
    if (command !== "candidate" && command !== "panels") {
      throw new Error("Usage: material.mjs candidate --sdk-version <version> | projections | panels --sdk-version <version>");
    }

    const at = args.indexOf("--sdk-version");
    const sdkVersion = at === -1 ? undefined : args[at + 1];
    if (!sdkVersion) throw new Error(`Usage: material.mjs ${command} --sdk-version <exact installed version>`);
    const output = command === "candidate"
      ? { files: candidateFiles(sdkVersion), message: `${name} panel candidate` }
      : panelMaterial(sdkVersion);
    console.log(JSON.stringify(output, null, 2));
  }

  return { PANEL_ID: id, manifest, messages, projections, panelContent, candidateFiles, panelInput, projectionMaterial, panelMaterial, runCli };
}
