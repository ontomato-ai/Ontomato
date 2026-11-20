import { createHash } from "node:crypto";
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

function expandInlineProjections(manifest, panel) {
  const inline = [];
  const members = Object.entries(manifest?.members ?? {}).map(([member, placement]) => {
    if (placement?.target?.projection === undefined) return [member, placement];
    if (!panel) throw new Error(`Member ${member}: inline projection needs a panel in the registration material`);
    const { target: { projection, ...otherTargets }, ...bindings } = placement;
    if (Object.keys(otherTargets).length || projection === null || typeof projection !== "object" || Array.isArray(projection)) {
      throw new Error(`Member ${member}: expected target.projection to be the only target`);
    }
    const { componentId, data, inputs = {}, outputs = {}, config = {}, name, description, ...unknown } = projection;
    if (Object.keys(unknown).length) throw new Error(`Member ${member}: unknown projection fields ${Object.keys(unknown).join(", ")}`);
    if (componentId === "@ontomato/sdk:MetricChart") throw new Error(`Member ${member}: register the chart through its source card and reference its ID`);
    const id = "panel-projection-" + createHash("sha256").update(JSON.stringify([panel.id, member])).digest("hex");
    inline.push({ member, id, input: { componentId, data, inputs, outputs, config, name, description } });
    return [member, { ...bindings, target: { projectionId: id } }];
  });
  return { manifest: inline.length ? { ...manifest, members: Object.fromEntries(members) } : manifest, inline };
}

async function workspaceDefinition(directory, files, checks, panel) {
  const descriptorFile = resolve(directory, "panel.json");
  const document = await readJson(descriptorFile);
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
  if (result.success) return { definition: result.data, inline: expanded.inline };

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

function checkOperation(id, projection, typeTable, placements, state) {
  const name = projection.data.operation?.source.operation?.id;
  const declarations = Object.entries(typeTable.objectTypes).flatMap(([type, owner]) =>
    (owner.operations ?? []).filter(operation => operation.id === name).map(operation => [type, operation]));
  if (declarations.length === 0) throw new Error(`projection ${id}: operation ${name ?? "(missing)"} is not declared in the type table`);
  function targetMatches(type, operation, port) {
    if (port?.kind === "list") return operation.batch && port.items.objectType === type;
    if (port?.kind === "object-union") {
      return "objectTypes" in port ? port.objectTypes.includes(type) : port.layers.includes(typeTable.objectTypes[type].layer);
    }
    return port?.kind === "object" && port.objectType === type;
  }
  const matched = declarations.filter(([type, operation]) => operation.target.source !== "input" ||
    targetMatches(type, operation, projection.inputs[operation.target.input]));
  const inputs = [...new Set(declarations.flatMap(([, operation]) => operation.target.source === "input" ? [operation.target.input] : []))];
  if (matched.length === 0) throw new Error(`projection ${id}: operation ${name} requires the owner target input ${inputs.join(" or ")}`);
  for (const [member, placement] of placements) {
    const bound = matched.some(([type, operation]) => {
      if (operation.target.source !== "input") return true;
      const binding = placement.inputs?.[operation.target.input];
      if (binding === undefined) return false;
      if (!("state" in binding)) return true;
      const target = state[binding.state].type;
      const port = projection.inputs[operation.target.input];
      return (port.kind === "list") === (target.kind === "list") && targetMatches(type, operation, target);
    });
    if (!bound) throw new Error(`member ${member} (projection ${id}): bind operation ${name}'s target input ${inputs.join(" or ")} to an object or checked list`);
  }
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
  for (const { member, id, input: projection } of inline) {
    if (projections.some(record => record.id === id)) throw new Error(`Member ${member}: projection ${id} is also in the registration material`);
    const record = currentRecord && await currentRecord("projection", id);
    if (record && previous?.manifest.members[member]?.target.projectionId !== id) {
      throw new Error(`Member ${member}: projection ${id} already exists and is not referenced by this member`);
    }
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
  return client.register(material, onRegistered, checks);
}

export async function checkPanelWorkspace(directory, { checks, catalogue, version, digest, typeTable, lookup, materialPath }) {
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
  const placements = new Map();
  for (const [key, member] of Object.entries(manifest.members)) {
    const { target } = member;
    if (target.projectionId !== undefined) {
      references.set(`projection:${target.projectionId}`, ["projection", target.projectionId]);
      const uses = placements.get(target.projectionId) ?? [];
      uses.push([key, member]);
      placements.set(target.projectionId, uses);
    }
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
    } else if (kind === "projection") {
      if (!components.has(record.componentId)) {
        throw new Error(`${resolve(directory, "panel.json")}: projection ${id} uses unavailable SDK component ${record.componentId}`);
      }
      if (typeTable && record.componentId === "@ontomato/sdk:OperationButton") {
        checkOperation(id, record, typeTable, placements.get(id), manifest.state);
      }
    }
  }
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}
