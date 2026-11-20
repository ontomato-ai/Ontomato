import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { panelRegistrationRecords, requireApplicationId } from "./panel-registration.mjs";

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

async function expandInlineProjections(manifest, panel, checks, loadAuthoring) {
  const first = Object.entries(manifest?.members ?? {}).find(([, member]) => member?.component !== undefined);
  if (!first) return { manifest, inline: [], charts: new Map() };
  if (!panel) throw new Error(`Member ${first[0]}: a new projection needs a panel in the registration material`);
  if (!loadAuthoring) throw new Error(`Member ${first[0]}: checking a new projection needs the online author type table`);

  const { state, members, ...definition } = checks.panelAuthoringManifestSchema.parse(manifest);
  const { catalogue, typeTable } = await loadAuthoring();
  const { components } = checks.appsSdkComponentCatalogSchema.parse(catalogue);
  const inline = [];
  const charts = new Map();
  const placements = Object.entries(members).map(([member, declaration]) => {
    if (!("component" in declaration)) return [member, declaration];
    if (declaration.sourceCard) {
      charts.set(member, declaration);
      // Keep the member present for local validation. The owner supplies the ID before it can be read or saved.
      return [member, { target: { projectionId: member } }];
    }
    const { id = randomUUID(), name, description } = declaration;
    const { projection, placement } = checks.expandPanelAuthoringMember(member, declaration, {
      state, components, typeTable,
    });
    inline.push({ member, id, needsId: declaration.id === undefined, input: { ...projection, name, description } });
    return [member, { ...placement, target: { projectionId: id } }];
  });
  return { manifest: { ...definition, state, members: Object.fromEntries(placements) }, inline, charts };
}

async function workspaceDefinition(directory, files, checks, panel, loadAuthoring) {
  const descriptorFile = resolve(directory, "panel.json");
  const source = await readFile(descriptorFile, "utf8");
  const document = parseJson(descriptorFile, source);
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${descriptorFile}: expected an object with a manifest`);
  }
  const { content = {}, manifest, ...descriptor } = document;
  const expanded = await expandInlineProjections(manifest, panel, checks, loadAuthoring);
  if (content === null || typeof content !== "object" || Array.isArray(content) ||
      Object.keys(content).some(key => key !== "messages")) {
    throw new Error(`${descriptorFile}: content only accepts messages`);
  }
  if (!files.includes("panel.mjs")) throw new Error(`${resolve(directory, "panel.mjs")}: required Vue module is missing`);
  const sources = [
    ["html", "panel.html"],
    ["module", "panel.mjs"],
    ...(files.includes("recipes.md") ? [["recipes", "recipes.md"]] : []),
  ];
  const contents = await Promise.all(sources.map(async ([key, file]) => [
    key, await readFile(resolve(directory, file), "utf8"),
  ]));
  const result = checks.panelDefinitionContentSchema.safeParse({
    ...descriptor, manifest: expanded.manifest, content: { ...content, ...Object.fromEntries(contents) },
  });
  if (result.success) {
    try {
      await checks.panelModuleImports(result.data.content.module);
    } catch (error) {
      throw new Error(`${resolve(directory, "panel.mjs")}: ${error.message}`, { cause: error });
    }
    return { definition: result.data, inline: expanded.inline, charts: expanded.charts, descriptorFile, document, source };
  }

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

function checkOperations(id, projection, typeTable, placements, state, checks) {
  for (const [name, binding] of Object.entries(projection.operations ?? {})) {
    const { id: operationId, kind } = binding.operation;
    const declarations = Object.entries(typeTable.objectTypes).flatMap(([type, owner]) => {
      if (kind !== (type.startsWith("platform:") ? "PlatformOperation" : "Action")) return [];
      return (owner.operations ?? []).filter(operation => operation.id === operationId).map(operation => [type, operation]);
    });
    const label = `operation ${name} (${operationId})`;
    if (declarations.length === 0) throw new Error(`projection ${id}: ${label} is not declared in the type table`);
    const matched = declarations.filter(([type, operation]) => checks.projectionOperationTargetMatches(projection, binding, operation, type));
    const input = binding.target?.input;
    if (matched.length === 0) throw new Error(`projection ${id}: ${label} has an invalid ${input ? `target input ${input}` : "target"}`);
    if (input === undefined) continue;
    const portKind = projection.inputs[input].kind;
    for (const [member, placement] of placements) {
      const value = placement.inputs?.[input];
      const bound = value && (!("state" in value) || matched.some(([type, operation]) =>
        checks.panelOperationTargetPort(state[value.state].type, type, operation.batch)?.kind === portKind));
      if (!bound) throw new Error(`member ${member} (projection ${id}): bind ${label}'s target input ${input} to an object or checked list`);
    }
  }
}

function checkProjectionData(id, projection, component, checks) {
  if (!("data" in projection)) return;
  const { data } = component;
  if (data === undefined) throw new Error(`projection ${id}: component ${projection.componentId} does not declare projection data`);
  for (const [name, declaration] of Object.entries(data)) {
    if (declaration.required && !Object.hasOwn(projection.data, name)) {
      throw new Error(`projection ${id}: data.${name} is required by ${projection.componentId}`);
    }
  }
  for (const [name, read] of Object.entries(projection.data)) {
    const datum = checks.appsSdkComponentDatum(data, name);
    if (!datum) throw new Error(`projection ${id}: data.${name} is not declared by ${projection.componentId}`);
    const { result } = checks.directReadDeclaration(projection, read);
    if (!datum.results.includes(result)) {
      throw new Error(`projection ${id}: data.${name} returns '${result}'. ${projection.componentId} accepts ${datum.results.join(", ")}`);
    }
  }
}

async function readPanelWorkspace(directory, checks, materialPath, loadAuthoring) {
  const files = await readdir(directory);
  const path = materialPath ?? (files.includes("registration.json") ? resolve(directory, "registration.json") : undefined);
  const material = path === undefined ? {} : await readJson(path);
  const panel = material.panels?.length === 1 ? material.panels[0] : undefined;
  if (panel && (typeof panel.id !== "string" || panel.id.length === 0)) {
    throw new Error(`${path}: panel ID is required`);
  }
  return { material, panel, ...await workspaceDefinition(directory, files, checks, panel, loadAuthoring) };
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

export async function registerPanelWorkspace(directory, materialPath, checks, client, onRegistered, loadAuthoring) {
  const workspace = await readPanelWorkspace(directory, checks, materialPath, loadAuthoring);
  const material = await workspaceRegistration(workspace, client.currentRecord);
  const { document, descriptorFile, source, inline, charts } = workspace;
  if (charts.size) {
    for (const { id, mode } of material.applications ?? []) {
      if (mode === "create") requireApplicationId(id);
    }
    panelRegistrationRecords(material, checks);
    const { members, state } = material.panels[0].input.manifest;
    for (const [member, declaration] of charts) {
      const projection = await client.registerChartSource(declaration.sourceCard, checks);
      members[member] = checks.bindPanelAuthoringChart(member, declaration, { state, projection });
      await onRegistered("projection", projection.id);
    }
  }
  const unassigned = new Map(inline.filter(({ needsId }) => needsId).map(({ id, member }) => [id, member]));
  const indent = /^([ \t]+)"/mu.exec(source)?.[1];
  const newline = source.endsWith("\n") ? "\n" : "";
  return client.register(material, async (kind, id) => {
    const member = kind === "projection" && unassigned.get(id);
    if (member) {
      document.manifest.members[member].id = id;
      await writeFile(descriptorFile, JSON.stringify(document, null, indent) + newline);
    }
    return onRegistered(kind, id);
  }, checks);
}

export async function checkPanelWorkspace(directory, { checks, catalogue, version, digest, typeTable, lookup, findChartSource, materialPath }) {
  if (catalogue.version !== version) {
    throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  }
  const loadAuthoring = typeTable && (() => ({ catalogue, typeTable }));
  const workspace = await readPanelWorkspace(directory, checks, materialPath, loadAuthoring);
  const { manifest } = workspace.definition;
  const material = workspace.inline.length || workspace.charts.size ? await workspaceRegistration(workspace) : workspace.material;
  const records = new Map(
    panelRegistrationRecords(material, checks).map(([kind, items]) => [
      kind, new Map(items.map(({ id, body }) => [id, body])),
    ]),
  );
  const unchecked = [];
  const unregisteredCharts = new Set();
  for (const [member, declaration] of workspace.charts) {
    const projection = await findChartSource(declaration.sourceCard);
    if (projection === null) {
      unchecked.push({
        kind: "chart-source", member, ...declaration.sourceCard,
        reason: "Chart input types can be checked after the owner registers this source card",
      });
      unregisteredCharts.add(member);
      continue;
    }
    manifest.members[member] = checks.bindPanelAuthoringChart(member, declaration, { state: manifest.state, projection });
    records.get("projection").set(projection.id, projection);
  }
  const components = new Map(catalogue.components.map(component => [`@ontomato/sdk:${component.componentId}`, component]));
  const references = new Map();
  const placements = new Map();
  for (const [key, member] of Object.entries(manifest.members)) {
    if (unregisteredCharts.has(key)) continue;
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

  for (const [kind, id] of references.values()) {
    const record = records.get(kind)?.get(id) ?? (lookup && await lookup(kind, id));
    if (record === null) {
      throw new Error(`${resolve(directory, "panel.json")}: ${kind} ${id} was not found in the material or on the platform`);
    } else if (record === undefined) {
      unchecked.push({ kind, id });
    } else if (kind === "projection") {
      const component = components.get(record.componentId);
      if (!component) {
        throw new Error(`${resolve(directory, "panel.json")}: projection ${id} uses unavailable SDK component ${record.componentId}`);
      }
      checkProjectionData(id, record, component, checks);
      if (typeTable) checkOperations(id, record, typeTable, placements.get(id), manifest.state, checks);
    }
  }
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}
