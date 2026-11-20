import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./declaration.mjs";
import messages from "./messages.mjs";
import projections from "./projections.mjs";

/*
 * The four-layer capability map panel's material, from one set of sources: `declaration.mjs`, `messages.mjs`,
 * `projections.mjs`, and the panel's three texts (`panel.html`, `panel.mjs`, `recipes.md`).
 *
 *   node material.mjs candidate
 *     The body of `POST /api/workspaces/<id>/import`: `panel.html`, `panel.mjs`, `recipes.md` and `panel.json`
 *     (`{manifest, content: {messages}}`), the files an author preview reads from the workspace.
 *   node material.mjs projections
 *     Registration material for `PUT /api/product-projections/<id>`: every projection the panel names, under its final ID.
 *   node material.mjs panels
 *     Registration material for `PUT /api/product-panels/<id>`: the capability map panel record without an SDK pin.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const text = (file) => readFileSync(join(HERE, file), "utf8");

export const PANEL_ID = "capability-map";

/** The panel's content: its HTML, its module, its recipes and its own words. */
export function panelContent() {
  return {
    html: text("panel.html"),
    module: text("panel.mjs"),
    ...(existsSync(join(HERE, "recipes.md")) ? { recipes: text("recipes.md") } : {}),
    messages,
  };
}

/** The files of the author's workspace candidate under the current single-release SDK. */
export function candidateFiles() {
  const { html, module, recipes, messages: words } = panelContent();
  const file = (path, content) => ({ path, content, encoding: "utf8" });
  return [
    file("panel.html", html),
    file("panel.mjs", module),
    ...(recipes === undefined ? [] : [file("recipes.md", recipes)]),
    file("panel.json", `${JSON.stringify({ manifest, content: { messages: words } }, null, 2)}\n`),
  ];
}

/** The registered panel record's input, carrying no SDK version pin. */
export function panelInput() {
  return {
    name: "Capability map",
    description: "Four-layer platform capability map across fact, capability, governance and product ontology layers.",
    visibility: "domain",
    content: panelContent(),
    manifest,
  };
}

/** Every projection the panel names, as create material under its final ID. */
export function projectionMaterial() {
  return { projections: projections.map(({ id, input }) => ({ id, mode: "create", input })) };
}

/** The panel record as create material under its final ID. */
export function panelMaterial() {
  return { panels: [{ id: PANEL_ID, mode: "create", input: panelInput() }] };
}

export { manifest, messages, projections };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command === "candidate") {
    console.log(JSON.stringify({ files: candidateFiles(), message: "Capability map panel candidate" }, null, 2));
  } else if (command === "projections") {
    console.log(JSON.stringify(projectionMaterial(), null, 2));
  } else if (command === "panels") {
    console.log(JSON.stringify(panelMaterial(), null, 2));
  } else {
    throw new Error("Usage: material.mjs candidate | projections | panels");
  }
}
