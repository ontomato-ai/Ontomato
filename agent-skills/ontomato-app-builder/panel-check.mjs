import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { panelRegistrationRecords } from "./panel-registration.mjs";

async function readJson(file) {
  const source = await readFile(file, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

async function workspaceDefinition(directory, checks) {
  const descriptorFile = resolve(directory, "panel.json");
  const document = await readJson(descriptorFile);
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${descriptorFile}: expected an object with a manifest`);
  }
  const { content = {}, ...descriptor } = document;
  if (content === null || typeof content !== "object" || Array.isArray(content) ||
      Object.keys(content).some(key => key !== "messages")) {
    throw new Error(`${descriptorFile}: content only accepts messages`);
  }
  const files = await readdir(directory);
  const sources = [
    ["html", "panel.html"],
    ...[["module", "panel.mjs"], ["recipes", "recipes.md"]].filter(([, file]) => files.includes(file)),
  ];
  const contents = await Promise.all(sources.map(async ([key, file]) => [
    key, await readFile(resolve(directory, file), "utf8"),
  ]));
  const result = checks.directPanelDefinitionContentSchema.safeParse({
    ...descriptor, content: { ...content, ...Object.fromEntries(contents) },
  });
  if (result.success) return result.data;

  const diagnostics = result.error.issues.map(issue => {
    const source = issue.path[0] === "content" && sources.find(([key]) => key === issue.path[1]);
    const file = source ? resolve(directory, source[1]) : descriptorFile;
    const position = issue.params?.line === undefined
      ? issue.path.join(".")
      : `${issue.params.line}:${issue.params.column}`;
    return `${file}${position ? `:${position}` : ""}: ${issue.message}`;
  });
  throw new Error(diagnostics.join("\n"));
}

export async function checkPanelWorkspace(directory, { checks, catalogue, version, digest, lookup, materialPath }) {
  if (catalogue.version !== version) {
    throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  }
  const { manifest } = await workspaceDefinition(directory, checks);
  const records = materialPath === undefined ? new Map() : new Map(
    panelRegistrationRecords(await readJson(materialPath), checks).map(([kind, items]) => [
      kind, new Map(items.map(({ id, body }) => [id, body])),
    ]),
  );
  const components = new Set(catalogue.components.map(({ componentId }) => `@ontomato/sdk:${componentId}`));
  const references = new Map();
  for (const { target } of Object.values(manifest.members)) {
    if (target.projectionId !== undefined) references.set(`projection:${target.projectionId}`, ["projection", target.projectionId]);
    if (target.panelId !== undefined) references.set(`panel:${target.panelId}`, ["panel", target.panelId]);
    for (const id of target.candidates?.panelIds ?? []) references.set(`panel:${id}`, ["panel", id]);
  }

  const unchecked = [];
  for (const [kind, id] of references.values()) {
    const record = records.get(kind)?.get(id) ?? (lookup && await lookup(kind, id));
    if (record === undefined) {
      unchecked.push({ kind, id });
    } else if (kind === "projection" && !components.has(record.componentId)) {
      throw new Error(`${resolve(directory, "panel.json")}: projection ${id} uses unavailable SDK component ${record.componentId}`);
    }
  }
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}
