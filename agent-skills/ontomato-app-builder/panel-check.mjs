import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { panelRegistrationRecords } from "./panel-registration.mjs";

function parseJson(file, source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

async function readJson(file) {
  return parseJson(file, await readFile(file, "utf8"));
}

function expandInlineProjections(manifest, panel) {
  const inline = [];
  const members = Object.entries(manifest?.members ?? {}).map(([member, placement]) => {
    if (placement?.target?.projection === undefined) return [member, placement];
    if (!panel) throw new Error(`Member ${member}: inline projection needs a panel in the registration material`);
    const { target: { projection, ...otherTargets }, ...bindings } = placement;
    if (Object.keys(otherTargets).length || projection === null || typeof projection !== "object" || Array.isArray(projection)) {
      throw new Error(`Member ${member}: expected target.projection to be the only target`);
    }
    const { id = randomUUID(), componentId, data, inputs = {}, outputs = {}, config = {}, name, description, ...unknown } = projection;
    if (Object.keys(unknown).length) throw new Error(`Member ${member}: unknown projection fields ${Object.keys(unknown).join(", ")}`);
    if (componentId === "@ontomato/sdk:MetricChart") throw new Error(`Member ${member}: register the chart through its source card and reference its ID`);
    inline.push({ member, id, needsId: projection.id === undefined, input: { componentId, data, inputs, outputs, config, name, description } });
    return [member, { ...bindings, target: { projectionId: id } }];
  });
  return { manifest: inline.length ? { ...manifest, members: Object.fromEntries(members) } : manifest, inline };
}

async function workspaceDefinition(directory, files, checks, panel) {
  const descriptorFile = resolve(directory, "panel.json");
  const source = await readFile(descriptorFile, "utf8");
  const document = parseJson(descriptorFile, source);
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${descriptorFile}: expected an object with a manifest`);
  }
  const { content = {}, manifest, ...descriptor } = document;
  const expanded = expandInlineProjections(manifest, panel);
  if (content === null || typeof content !== "object" || Array.isArray(content) ||
      Object.keys(content).some(key => key !== "messages")) {
    throw new Error(`${descriptorFile}: content only accepts messages`);
  }
  const sources = [
    ["html", "panel.html"],
    ...[["module", "panel.mjs"], ["recipes", "recipes.md"]].filter(([, file]) => files.includes(file)),
  ];
  const contents = await Promise.all(sources.map(async ([key, file]) => [
    key, await readFile(resolve(directory, file), "utf8"),
  ]));
  const result = checks.panelDefinitionContentSchema.safeParse({
    ...descriptor, manifest: expanded.manifest, content: { ...content, ...Object.fromEntries(contents) },
  });
  if (result.success) return { definition: result.data, inline: expanded.inline, descriptorFile, document, source };

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

async function readPanelWorkspace(directory, checks, materialPath) {
  const files = await readdir(directory);
  const path = materialPath ?? (files.includes("registration.json") ? resolve(directory, "registration.json") : undefined);
  const material = path === undefined ? {} : await readJson(path);
  const panel = material.panels?.length === 1 ? material.panels[0] : undefined;
  if (panel && (typeof panel.id !== "string" || panel.id.length === 0)) {
    throw new Error(`${path}: panel ID is required`);
  }
  return { material, panel, ...await workspaceDefinition(directory, files, checks, panel) };
}

async function workspaceRegistration({ panel, inline, material, definition }, currentRecord) {
  if (!panel) throw new Error("Workspace registration requires exactly one panel in the registration material");
  const input = panel.input;
  if (Object.hasOwn(input, "manifest") || Object.hasOwn(input, "content")) {
    throw new Error(`Panel ${panel.id}: write manifest and content in the workspace sources`);
  }
  const previous = currentRecord ? await currentRecord("panel", panel.id) : undefined;
  if (currentRecord && panel.mode === "update" && previous?.revision !== panel.revision) throw new Error(`Panel ${panel.id}: revision conflict`);
  if (panel.mode === "create" && previous) throw new Error(`Panel ${panel.id}: already exists`);
  const projections = [...(material.projections ?? [])];
  for (const { member, id, needsId, input: projection } of inline) {
    if (projections.some(record => record.id === id)) throw new Error(`Member ${member}: projection ${id} already has a definition in this registration`);
    const record = needsId ? undefined : await currentRecord?.("projection", id);
    projections.push({
      id, ...(record ? { mode: "update", revision: record.revision } : { mode: "create" }),
      input: { ...projection, name: projection.name ?? record?.name ?? member,
        description: projection.description ?? record?.description ?? member,
        visibility: record?.visibility ?? input.visibility },
    });
  }
  return { ...material, projections, panels: [{ ...panel, input: { ...input, ...definition } }] };
}

export async function registerPanelWorkspace(directory, materialPath, checks, client, onRegistered) {
  const workspace = await readPanelWorkspace(directory, checks, materialPath);
  const material = await workspaceRegistration(workspace, client.currentRecord);
  const { document, descriptorFile, source, inline } = workspace;
  const unassigned = new Map(inline.filter(({ needsId }) => needsId).map(({ id, member }) => [id, member]));
  const indent = /^([ \t]+)"/mu.exec(source)?.[1];
  const newline = source.endsWith("\n") ? "\n" : "";
  return client.register(material, async (kind, id) => {
    const member = kind === "projection" && unassigned.get(id);
    if (member) {
      document.manifest.members[member].target.projection.id = id;
      await writeFile(descriptorFile, JSON.stringify(document, null, indent) + newline);
    }
    return onRegistered(kind, id);
  }, checks);
}

export async function checkPanelWorkspace(directory, { checks, catalogue, version, digest, lookup, materialPath }) {
  if (catalogue.version !== version) {
    throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  }
  const workspace = await readPanelWorkspace(directory, checks, materialPath);
  const { manifest } = workspace.definition;
  const material = workspace.inline.length ? await workspaceRegistration(workspace) : workspace.material;
  const records = new Map(
    panelRegistrationRecords(material, checks).map(([kind, items]) => [
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
    if (record === null) {
      throw new Error(`${resolve(directory, "panel.json")}: ${kind} ${id} was not found in the material or on the platform`);
    } else if (record === undefined) {
      unchecked.push({ kind, id });
    } else if (kind === "projection" && !components.has(record.componentId)) {
      throw new Error(`${resolve(directory, "panel.json")}: projection ${id} uses unavailable SDK component ${record.componentId}`);
    }
  }
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}
