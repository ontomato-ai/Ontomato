import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { panelRegistrationRecords, requireApplicationId, requireDomainProductId } from "./panel-registration.mjs";

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

function writePanelDescriptor(file, document, source) {
  const indent = /^([ \t]+)"/mu.exec(source)?.[1];
  const newline = source.endsWith("\n") ? "\n" : "";
  return writeFile(file, JSON.stringify(document, null, indent) + newline);
}

function formatAuthoringViolations(violations) {
  return violations.map(v => `${v.file}:${v.line}:${v.column}: ${v.message}`).join("\n");
}

async function checkPanelAuthoringSources({
  directory, files, descriptorFile, theme, html, module, checks,
}) {
  const violations = [];
  if (theme && checks.checkAuthoringTheme) {
    violations.push(...checks.checkAuthoringTheme(theme, descriptorFile));
  }
  if (html !== undefined && checks.checkAuthoringTemplate) {
    violations.push(...checks.checkAuthoringTemplate(html, resolve(directory, "panel.html")));
  }
  if (module !== undefined && checks.checkAuthoringScript) {
    violations.push(...await checks.checkAuthoringScript(module, resolve(directory, "panel.mjs")));
  }
  if (checks.checkAuthoringStyles) {
    for (const name of files.filter(entry => entry.endsWith(".css")).sort()) {
      const cssFile = resolve(directory, name);
      const css = await readFile(cssFile, "utf8");
      violations.push(...checks.checkAuthoringStyles(css, cssFile));
    }
  }
  if (violations.length) throw new Error(formatAuthoringViolations(violations));
}

export async function checkBuiltinPanelSource(
  directory,
  checks,
  { assignIds = false } = {},
) {
  if (!checks.builtinProductIdSchema) throw new Error("Use an SDK release that supports platform product IDs");
  const registrationFile = resolve(directory, "registration.json");
  const { panels } = await readJson(registrationFile);
  if (!Array.isArray(panels) || panels.length !== 1) throw new Error(`${registrationFile}: expected exactly one platform panel`);
  const [panel] = panels;
  function platformId(id, label) {
    const result = checks.builtinProductIdSchema.safeParse(id);
    if (!result.success) throw new Error(`${label}: ${result.error.issues[0].message}`);
    return result.data;
  }
  const panelId = platformId(panel.id, `${registrationFile}: panel ID`);
  const file = resolve(directory, "panel.json");
  const source = await readFile(file, "utf8");
  const document = parseJson(file, source);
  const parsed = checks.panelAuthoringManifestSchema.safeParse(document?.manifest);
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`);
  for (const [member, declaration] of Object.entries(parsed.data.members)) {
    if (!("component" in declaration) || declaration.operation === undefined) continue;
    if (!Array.isArray(checks.draftReadOperationIds)) {
      throw new Error("Use an SDK release that includes the draft requirements of owner operations");
    }
    if (!checks.draftReadOperationIds.includes(declaration.operation)) continue;
    const label = `${file}: member ${member} operation '${declaration.operation}'`;
    if (declaration.draft === undefined) throw new Error(`${label}: draft must name the form member whose values the operation reads`);
    if (!Object.hasOwn(parsed.data.members, declaration.draft)) {
      throw new Error(`${label}: draft names undeclared member '${declaration.draft}'`);
    }
  }
  // A platform panel ships to every language: an entry's opening sentence named by key is in each language it declares.
  for (const [member, declaration] of Object.entries(parsed.data.members)) {
    if (declaration.prefillKey === undefined) continue;
    const missing = checks.missingEntryMessageKeys([{ prefillKey: declaration.prefillKey }], document.content?.messages);
    if (missing.length) {
      const where = missing.map(({ locale }) => locale ?? "any locale").join(", ");
      throw new Error(`${file}: member ${member} prefillKey '${declaration.prefillKey}' is not in content.messages (${where})`);
    }
  }

  const files = await readdir(directory);
  const trialPath = "/applications/app-";
  const sourceTexts = {};
  for (const name of ["panel.html", "panel.mjs", "recipes.md"]) {
    if (!files.includes(name)) continue;
    const path = resolve(directory, name);
    const text = await readFile(path, "utf8");
    sourceTexts[name] = text;
    const offset = text.indexOf(trialPath);
    if (offset === -1) continue;
    const lines = text.slice(0, offset).split(/\r\n|[\r\n]/u);
    const column = lines.at(-1).length + 1;
    throw new Error(`${path}:${lines.length}:${column}: Replace the domain application address (${trialPath}…) with a built-in entry address.`);
  }
  if (sourceTexts["panel.mjs"] !== undefined && checks.panelModuleImports) {
    try {
      await checks.panelModuleImports(sourceTexts["panel.mjs"]);
    } catch (error) {
      throw new Error(`${resolve(directory, "panel.mjs")}: ${error.message}`, { cause: error });
    }
  }
  await checkPanelAuthoringSources({
    directory,
    files,
    descriptorFile: file,
    theme: document.theme,
    html: sourceTexts["panel.html"],
    module: sourceTexts["panel.mjs"],
    checks,
  });

  const assigned = new Map();
  for (const [member, declaration] of Object.entries(parsed.data.members)) {
    if (!("component" in declaration)) continue;
    if (declaration.id === undefined && assignIds) {
      const id = checks.BUILTIN_PRODUCT_ID_PREFIX + randomUUID();
      const withId = checks.panelAuthoringMemberSchema.safeParse({ ...declaration, id });
      if (!withId.success) throw new Error(`${file}: manifest.members.${member}.id: ${withId.error.issues[0].message}`);
      document.manifest.members[member].id = id;
      assigned.set(member, id);
    } else {
      platformId(declaration.id, `${file}: manifest.members.${member}.id`);
    }
  }
  if (assigned.size) await writePanelDescriptor(file, document, source);
  return { panelId, assigned: Object.fromEntries(assigned) };
}

function domainComponentId(componentId) {
  return componentId.startsWith("domain-component:");
}

function componentPackageName(componentId) {
  if (domainComponentId(componentId)) return undefined;
  const separator = componentId.indexOf(":");
  const name = separator > 0 ? componentId.slice(0, separator) : undefined;
  return name === "@ontomato/sdk" ? undefined : name;
}

function formatManifestIssues(descriptorFile, manifest, error) {
  const lines = [];
  for (const issue of error.issues) {
    if (issue.code === "invalid_union" && issue.path[0] === "members" && typeof issue.path[1] === "string") {
      const raw = manifest?.members?.[issue.path[1]];
      const branchIndex = raw && typeof raw === "object" && "component" in raw ? 0 : 1;
      const branch = issue.unionErrors?.[branchIndex] ?? issue.unionErrors?.[0];
      if (branch?.issues?.length) {
        for (const inner of branch.issues) {
          const fullPath = ["manifest", ...issue.path, ...inner.path].join(".");
          lines.push(`${descriptorFile}: ${fullPath}: ${inner.message}`);
        }
        continue;
      }
    }
    const fullPath = ["manifest", ...issue.path].join(".");
    lines.push(`${descriptorFile}: ${fullPath}: ${issue.message}`);
  }
  return lines.join("\n");
}

async function expandInlineProjections(descriptorFile, manifest, panel, checks, loadAuthoring, loadPackage, loadDomainComponent) {
  const declared = Object.entries(manifest?.members ?? {}).filter(([, member]) => member?.component !== undefined);
  if (!declared.length) return { manifest, inline: [], charts: new Map() };
  for (const [member, item] of declared) {
    if (item.id !== undefined) requireDomainProductId(`Member ${member} id ${item.id}`, item.id, checks);
  }
  const [[first]] = declared;
  if (!panel) throw new Error(`Member ${first}: a new projection needs a panel in the registration material`);
  if (!loadAuthoring) throw new Error(`Member ${first}: checking a new projection needs the author type table (online or --type-table)`);

  const parsedManifest = checks.panelAuthoringManifestSchema.safeParse(manifest);
  if (!parsedManifest.success) {
    throw new Error(formatManifestIssues(descriptorFile, manifest, parsedManifest.error));
  }
  const { state, members, ...definition } = parsedManifest.data;
  const { catalogue, typeTable } = await loadAuthoring();
  const packages = new Set(declared.map(([, member]) => componentPackageName(member.component)).filter(Boolean));
  const installed = await Promise.all([...packages].map(name => loadPackage?.(name)));
  const components = [
    ...checks.appsSdkComponentCatalogSchema.parse(catalogue).components,
    ...installed.flatMap(release => release?.components ?? []),
    ...(await Promise.all([...new Set(declared.map(([, member]) => member.component).filter(domainComponentId))]
      .map(id => loadDomainComponent?.(id)))).filter(Boolean),
  ];
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

async function workspaceDefinition(
  directory, files, checks, panel, loadAuthoring, loadPackage, loadDomainComponent,
) {
  const descriptorFile = resolve(directory, "panel.json");
  const source = await readFile(descriptorFile, "utf8");
  const document = parseJson(descriptorFile, source);
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${descriptorFile}: expected an object with a manifest`);
  }
  const { content = {}, manifest, ...descriptor } = document;
  const expanded = await expandInlineProjections(descriptorFile, manifest, panel, checks, loadAuthoring, loadPackage, loadDomainComponent);
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
  const themeViolations = document.theme && checks.checkAuthoringTheme
    ? checks.checkAuthoringTheme(document.theme, descriptorFile)
    : [];
  if (themeViolations.length) throw new Error(formatAuthoringViolations(themeViolations));

  const result = checks.panelDefinitionContentSchema.safeParse({
    ...descriptor, manifest: expanded.manifest, content: { ...content, ...Object.fromEntries(contents) },
  });
  if (result.success) {
    try {
      await checks.panelModuleImports(result.data.content.module);
    } catch (error) {
      throw new Error(`${resolve(directory, "panel.mjs")}: ${error.message}`, { cause: error });
    }
    await checkPanelAuthoringSources({
      directory,
      files,
      descriptorFile,
      html: result.data.content.html,
      module: result.data.content.module,
      checks,
    });

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
    if (matched.some(([, operation]) => operation.effect === "read" && operation.target.source === "draft")) {
      for (const [member, placement] of placements) {
        if (!placement.readOperationInputs?.[name]?.draft) {
          throw new Error(`member ${member} (projection ${id}): bind ${label} to a form member's draft`);
        }
      }
    }
    if (input === undefined) continue;
    const expectedPort = projection.inputs[input];
    for (const [member, placement] of placements) {
      const value = placement.inputs?.[input];
      const bound = value && (!("state" in value) || matched.some(([type, operation]) => {
        const statePort = state[value.state].type;
        const accepted = checks.panelOperationTargetPort(statePort, type, operation.batch);
        if (!accepted) return false;
        return expectedPort.kind === "json" || (checks.panelPortAccepts
          ? checks.panelPortAccepts(expectedPort, statePort)
          : accepted.kind === expectedPort.kind);
      }));
      if (!bound) throw new Error(`member ${member} (projection ${id}): bind ${label}'s target input ${input} to an object or checked list`);
    }
  }
}

function checkProjectionData(id, projection, component, checks, placements = []) {
  if (!("data" in projection)) return;
  for (const [member, placement] of placements) {
    if (placement.listColumn !== undefined && Object.keys(projection.data).length > 0) {
      throw new Error(
        `member ${member} (projection ${id}, listColumn ${placement.listColumn.slot}.${placement.listColumn.column}): listColumn members cannot declare independent data reads. Pass row values through inputs ({ itemField } / { item }) or use listRowDetail when each expanded row reads child data.`,
      );
    }
  }
  const { data } = component;
  const hostMountedOnly = placements.length > 0 && placements.every(([, placement]) =>
    checks.isHostMountedPanelMember
      ? checks.isHostMountedPanelMember(placement)
      : Boolean(placement.formField || placement.listColumn || placement.listRowDetail));
  if (data === undefined) {
    if (hostMountedOnly && Object.keys(projection.data).length === 0) return;
    throw new Error(`projection ${id}: component ${projection.componentId} does not declare projection data`);
  }
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

async function readPanelWorkspace(
  directory, checks, materialPath, loadAuthoring, loadPackage, loadDomainComponent,
) {
  const files = await readdir(directory);
  const path = materialPath ?? (files.includes("registration.json") ? resolve(directory, "registration.json") : undefined);
  const material = path === undefined ? {} : await readJson(path);
  const panel = material.panels?.length === 1 ? material.panels[0] : undefined;
  if (panel) {
    if (typeof panel.id !== "string" || panel.id.length === 0) throw new Error(`${path}: panel ID is required`);
    requireDomainProductId(`${path}: panel ID ${panel.id}`, panel.id, checks);
  }
  return {
    material,
    panel,
    ...await workspaceDefinition(
      directory, files, checks, panel, loadAuthoring, loadPackage, loadDomainComponent,
    ),
  };
}

const projectionRecordMetadata = new Set([
  "id", "domainId", "ownerId", "editable", "revision", "createdAt", "updatedAt",
]);

function storedProjectionDefinition(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !projectionRecordMetadata.has(key)));
}

async function workspaceRegistration({ panel, inline, material, definition }, client, checks) {
  if (!panel) throw new Error("Workspace registration requires exactly one panel in the registration material");
  const input = panel.input;
  if (Object.hasOwn(input, "manifest") || Object.hasOwn(input, "content")) {
    throw new Error(`Panel ${panel.id}: write manifest and content in the workspace sources`);
  }
  const previous = await client?.currentRecord("panel", panel.id);
  if (client && panel.mode === "update" && previous?.revision !== panel.revision) throw new Error(`Panel ${panel.id}: revision conflict`);
  if (panel.mode === "create" && previous) throw new Error(`Panel ${panel.id}: already exists`);
  const projections = [...(material.projections ?? [])];
  const ids = new Set(projections.map(record => record.id));
  for (const entry of inline) {
    const { member, needsId, input: projection } = entry;
    const savedId = needsId && Object.hasOwn(previous?.manifest?.members ?? {}, member)
      ? previous.manifest.members[member].target.projectionId : undefined;
    const id = savedId ?? entry.id;
    if (ids.has(id)) throw new Error(`Member ${member}: projection ${id} already has a definition in this registration`);
    ids.add(id);
    const record = !needsId || savedId !== undefined ? await client?.currentRecord("projection", id) : undefined;
    const next = { ...projection, name: projection.name ?? record?.name ?? member,
      description: projection.description ?? record?.description ?? member, visibility: record?.visibility ?? input.visibility };
    if (savedId !== undefined) {
      if (!record) throw new Error(`Member '${member}' references unavailable projection '${id}'.`);
      entry.id = id;
      definition.manifest.members[member].target = { projectionId: id };
      if (!record.editable)
        throw new Error(`Member '${member}' has no edit Grant for projection '${id}'. Rename the member to create a new projection.`);
      if (isDeepStrictEqual(next, storedProjectionDefinition(record))) {
        entry.reusedWithoutWrite = true;
        continue;
      }
      const { panels, hiddenCount } = await client.projectionUsedBy(id, checks);
      const others = panels.filter(user => user.id !== panel.id);
      if (others.length || hiddenCount) {
        const users = others.map(user => `${user.name} (${user.id})`);
        if (hiddenCount) users.push(`${hiddenCount} panel(s) you cannot view`);
        throw new Error(`Member '${member}' would change shared projection '${id}', also used by ${users.join(", ")}. Set id: "${id}" to update the shared definition, or rename the member to create its own projection.`);
      }
      entry.recoveredUpdate = true;
    }
    projections.push({ id, ...(record ? { mode: "update", revision: record.revision } : { mode: "create" }), input: next });
  }
  return { ...material, projections, panels: [{ ...panel, input: { ...input, ...definition } }] };
}

export async function registerPanelWorkspace(directory, materialPath, checks, client, onRegistered, loadAuthoring, loadPackage, loadDomainComponent) {
  const workspace = await readPanelWorkspace(directory, checks, materialPath, loadAuthoring, loadPackage, loadDomainComponent);
  const material = await workspaceRegistration(workspace, client, checks);
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
  const unassigned = new Map(inline.filter(({ needsId }) => needsId).map(entry => [entry.id, entry]));
  const recoveredProjectionPanels = new Map(inline.filter(entry => entry.recoveredUpdate).map(entry => [entry.id, workspace.panel.id]));
  const result = await client.register(material, async (kind, id) => {
    const entry = kind === "projection" && unassigned.get(id);
    if (entry) {
      document.manifest.members[entry.member].id = id;
      await writePanelDescriptor(descriptorFile, document, source);
    }
    return onRegistered(kind, id, { recoveredUpdate: Boolean(entry && entry.recoveredUpdate) });
  }, checks, recoveredProjectionPanels);
  const reused = inline.filter(entry => entry.reusedWithoutWrite);
  if (reused.length) {
    for (const { member, id } of reused) document.manifest.members[member].id = id;
    await writePanelDescriptor(descriptorFile, document, source);
  }
  return result;
}

export async function checkPanelWorkspace(directory, {
  checks, catalogue, version, digest, typeTable, lookup, findChartSource, materialPath, loadPackage, loadDomainComponent,
}) {
  if (catalogue.version !== version) {
    throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  }
  const loadAuthoring = typeTable && (() => ({ catalogue, typeTable }));
  const workspace = await readPanelWorkspace(
    directory, checks, materialPath, loadAuthoring, loadPackage, loadDomainComponent,
  );
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
    const projection = await findChartSource?.(declaration.sourceCard);
    if (projection == null) {
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

  const resolvedProjections = new Map();
  for (const [kind, id] of references.values()) {
    const record = records.get(kind)?.get(id) ?? (lookup && await lookup(kind, id));
    if (record === null) {
      throw new Error(`${resolve(directory, "panel.json")}: ${kind} ${id} was not found in the material or on the platform`);
    } else if (record === undefined) {
      unchecked.push({ kind, id });
    } else if (kind === "projection") {
      resolvedProjections.set(id, record);
      const packageName = componentPackageName(record.componentId);
      const release = packageName && await loadPackage?.(packageName);
      const component = domainComponentId(record.componentId)
        ? await loadDomainComponent?.(record.componentId)
        : release
          ? release.components.find(entry => entry.componentId === record.componentId)
          : components.get(record.componentId);
      if (!component) {
        throw new Error(`${resolve(directory, "panel.json")}: projection ${id} uses unavailable component ${record.componentId}`);
      }
      checkProjectionData(id, record, component, checks, placements.get(id));
      if (typeTable) checkOperations(id, record, typeTable, placements.get(id), manifest.state, checks);
      // A conversation entry's opening sentence named by key is the placing panel's own words, in each language it
      // declares: a reused projection's key counts as much as a new one's.
      if (record.conversationEntry?.prefillKey !== undefined) {
        const missing = checks.missingEntryMessageKeys([record.conversationEntry], workspace.definition.content.messages);
        if (missing.length) {
          const members = placements.get(id).map(([member]) => member).join(", ");
          const where = missing.map(({ locale }) => locale ?? "any locale").join(", ");
          throw new Error(`${resolve(directory, "panel.json")}: member ${members} (projection ${id}) prefillKey '${missing[0].key}' is not in content.messages (${where})`);
        }
      }
    }
  }
  const descriptorFile = resolve(directory, "panel.json");
  for (const [memberKey, member] of Object.entries(manifest.members)) {
    if (member.listColumn) {
      const { slot, column } = member.listColumn;
      const hostId = manifest.members[slot]?.target?.projectionId;
      const host = hostId ? resolvedProjections.get(hostId) : undefined;
      if (host) {
        if (host.componentId !== "@ontomato/sdk:ObjectList") {
          throw new Error(
            `${descriptorFile}: manifest.members.${memberKey}.listColumn.slot: host member '${slot}' uses '${host.componentId}', not '@ontomato/sdk:ObjectList'. Bind listColumn.slot to an ObjectList member.`,
          );
        }
        if (!Array.isArray(host.config?.columns)) {
          throw new Error(
            `${descriptorFile}: manifest.members.${memberKey}.listColumn.column: host ObjectList '${slot}' has no config.columns (compact list mode). Add { "key": "${column}" } to manifest.members.${slot}.config.columns.`,
          );
        }
        const declaredColumns = host.config.columns
          .filter(entry => entry && typeof entry === "object" && typeof entry.key === "string")
          .map(entry => entry.key);
        if (!declaredColumns.includes(column)) {
          const available = declaredColumns.length ? declaredColumns.join(", ") : "none";
          throw new Error(
            `${descriptorFile}: manifest.members.${memberKey}.listColumn.column: column '${column}' is not declared in host ObjectList '${slot}' config.columns (${available}). Add { "key": "${column}" } to config.columns or fix listColumn.column.`,
          );
        }
      }
    }
    if (member.listRowDetail) {
      const { slot } = member.listRowDetail;
      const hostId = manifest.members[slot]?.target?.projectionId;
      const host = hostId ? resolvedProjections.get(hostId) : undefined;
      if (host && host.componentId !== "@ontomato/sdk:ObjectList") {
        throw new Error(
          `${descriptorFile}: manifest.members.${memberKey}.listRowDetail.slot: host member '${slot}' uses '${host.componentId}', not '@ontomato/sdk:ObjectList'. Bind listRowDetail.slot to an ObjectList member.`,
        );
      }
    }
  }
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}
