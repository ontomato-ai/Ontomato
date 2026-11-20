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
      ...(existsSync(new URL("panel.mjs", entryUrl)) ? { module: text("panel.mjs") } : {}),
      ...(existsSync(new URL("recipes.md", entryUrl)) ? { recipes: text("recipes.md") } : {}),
      messages,
    };
  }

  function candidateFiles() {
    const { html, module, recipes } = panelContent();
    const file = (path, content) => ({ path, content, encoding: "utf8" });
    return [
      file("panel.html", html),
      ...(module === undefined ? [] : [file("panel.mjs", module)]),
      ...(recipes === undefined ? [] : [file("recipes.md", recipes)]),
      file("panel.json", `${JSON.stringify({ manifest, content: { messages } }, null, 2)}\n`),
    ];
  }

  function panelInput() {
    return { name, description, visibility: "domain", content: panelContent(), manifest };
  }

  function projectionMaterial() {
    return { projections: projections.map(({ id, input }) => ({ id, mode: "create", input })) };
  }

  function panelMaterial() {
    return { panels: [{ id, mode: "create", input: panelInput() }] };
  }

  function runCli() {
    if (process.argv[1] !== fileURLToPath(entryUrl)) return;
    const [command, ...args] = process.argv.slice(2);
    if (args.length || !["candidate", "projections", "panels"].includes(command)) {
      throw new Error("Usage: material.mjs candidate | projections | panels");
    }
    if (command === "projections") {
      console.log(JSON.stringify(projectionMaterial(), null, 2));
      return;
    }
    const output = command === "candidate"
      ? { files: candidateFiles(), message: `${name} panel candidate` }
      : panelMaterial();
    console.log(JSON.stringify(output, null, 2));
  }

  return { PANEL_ID: id, manifest, messages, projections, panelContent, candidateFiles, panelInput, projectionMaterial, panelMaterial, runCli };
}
