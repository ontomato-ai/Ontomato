import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { installedPanelSdk } from "./current-sdk.mjs";
import { panelRegistrationRecords, requireDomainProductId } from "./panel-registration.mjs";

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

function checkObjectFormOperations(file, members) {
  const entries = Object.entries(members);
  for (const [member, declaration] of entries) {
    if (declaration.component !== "ObjectForm" && declaration.component !== "@ontomato/sdk:ObjectForm") continue;
    if (declaration.operation !== undefined || Object.keys(declaration.operations ?? {}).length) continue;
    const hasSiblingDraft = entries.some(([name, sibling]) => name !== member && (
      sibling.draft === member ||
      Object.values(sibling.operationDrafts ?? {}).some(draft => draft.slot === member) ||
      Object.values(sibling.operations ?? {}).some(operation => operation.draft === member)
    ));
    if (!hasSiblingDraft) {
      throw new Error(`${file}: member ${member}: ObjectForm requires an operation or a sibling operation that references this form through draft or operationDrafts, even with config.actions: "none".`);
    }
  }
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
  checkObjectFormOperations(file, parsed.data.members);
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

export async function expandInlineProjections(descriptorFile, manifest, panel, checks, loadAuthoring, loadPackage, loadDomainComponent) {
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
  checkObjectFormOperations(descriptorFile, members);
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
  directory, files, checks, panel, loadAuthoring, loadPackage, loadDomainComponent, appSource = false,
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
  const sources = [
    ["html", "panel.html"],
    ...(files.includes("panel.mjs") ? [["module", "panel.mjs"]] : []),
    ...(files.includes("panel.css") ? [["style", "panel.css"]] : []),
    ...(files.includes("recipes.md") ? [["recipes", "recipes.md"]] : []),
  ];
  const contents = await Promise.all(sources.map(async ([key, file]) => [
    key, await readFile(resolve(directory, file), "utf8"),
  ]));
  const themeViolations = document.theme && checks.checkAuthoringTheme
    ? checks.checkAuthoringTheme(document.theme, descriptorFile)
    : [];
  if (themeViolations.length) throw new Error(formatAuthoringViolations(themeViolations));

  const schema = appSource ? checks.registerProductPanelRequestSchema.omit({ revision: true }) : checks.panelDefinitionContentSchema;
  const result = schema.safeParse({
    ...descriptor, manifest: expanded.manifest, content: { ...content, ...Object.fromEntries(contents) },
  });
  if (result.success) {
    if (result.data.content.module !== undefined) {
      try {
        await checks.panelModuleImports(result.data.content.module);
      } catch (error) {
        throw new Error(`${resolve(directory, "panel.mjs")}: ${error.message}`, { cause: error });
      }
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
    const typedDeclarations = Object.entries(typeTable.objectTypes).flatMap(([type, owner]) => {
      if (kind !== (type.startsWith("platform:") ? "PlatformOperation" : "Action")) return [];
      return (owner.operations ?? []).filter(operation => operation.id === operationId).map(operation => [type, operation]);
    });
    const globalDeclarations = kind === "Action"
      ? (typeTable.operations ?? []).filter(operation => operation.id === operationId).map(operation => [undefined, operation])
      : [];
    const declarations = [...typedDeclarations, ...globalDeclarations];
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
        const accepted = checks.panelOperationTargetPort(statePort, type, operation.batch, operation.targetTypes);
        if (!accepted) return false;
        return expectedPort.kind === "json" || (checks.panelPortAccepts
          ? checks.panelPortAccepts(expectedPort, statePort)
          : accepted.kind === expectedPort.kind);
      }));
      if (!bound) throw new Error(`member ${member} (projection ${id}): bind ${label}'s target input ${input} to an object or checked list`);
    }
  }
}

function checkProjectionData(id, projection, component, checks) {
  if (!("data" in projection)) return;
  const { data } = component;
  if (data === undefined) {
    if (Object.keys(projection.data).length === 0) return;
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
  if ((await readdir(directory)).includes("application.json")) {
    throw new Error("Publish application source through the Application Builder page after user confirmation.");
  }
  const workspace = await readPanelWorkspace(directory, checks, materialPath, loadAuthoring, loadPackage, loadDomainComponent);
  const material = await workspaceRegistration(workspace, client, checks);
  const { document, descriptorFile, source, inline, charts } = workspace;
  if (charts.size) {
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

async function sourceEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function readApplicationWorkspace(directory, checks) {
  const file = resolve(directory, "application.json");
  const application = await readJson(file);
  if (application?.entry?.renderer !== "panels" || !application.declaration?.names) {
    throw new Error(`${file}: expected an application declaration and a panels entry`);
  }
  const { shape } = checks.applicationCatalogueRecordSchema;
  const result = checks.applicationCatalogueRecordSchema.pick({
    entry: true, panelUses: true, initialOpenEntryIds: true, allowStandalone: true, framePanelId: true, theme: true, delivery: true,
  }).extend({
    declaration: checks.applicationIdentityUpdateSchema.omit({ allowStandalone: true }).extend({ groups: shape.groups }).passthrough(),
  }).safeParse(application);
  if (!result.success) throw new Error(`${file}: ${result.error.message}`);

  const panelsDir = resolve(directory, "panels");
  const workspaces = [];
  const panels = new Map();
  for (const entry of await sourceEntries(panelsDir)) {
    if (!entry.isDirectory()) continue;
    const panelDir = resolve(panelsDir, entry.name);
    const files = await readdir(panelDir);
    if (!files.includes("panel.json")) continue;
    requireDomainProductId(panelDir, entry.name, checks);
    const workspace = await workspaceDefinition(panelDir, files, checks, undefined, undefined, undefined, undefined, true);
    workspace.panel = { id: entry.name };
    workspaces.push(workspace);
    panels.set(entry.name, workspace.definition);
  }
  const projections = new Map();
  const projectionsDir = resolve(directory, "projections");
  for (const entry of await sourceEntries(projectionsDir)) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = resolve(projectionsDir, entry.name);
    const id = entry.name.slice(0, -5);
    requireDomainProductId(file, id, checks);
    const result = checks.productProjectionInputSchema.safeParse(await readJson(file));
    if (!result.success) throw new Error(`${file}: ${result.error.message}`);
    projections.set(id, result.data);
  }
  return { application, workspaces, records: new Map([["panel", panels], ["projection", projections]]) };
}

export async function checkPanelWorkspace(directory, options) {
  const { checks, catalogue, version, digest, typeTable, lookup, materialPath, loadPackage, loadDomainComponent } = options;
  if (catalogue.version !== version) {
    throw new Error(`Expected SDK catalogue ${version}, found ${catalogue.version}`);
  }
  const unchecked = [];
  if ((await readdir(directory)).includes("application.json")) {
    if (materialPath !== undefined) throw new Error("--material is only for legacy panel directories");
    const { application, workspaces, records } = await readApplicationWorkspace(directory, checks);
    const applications = [{ id: directory, input: application }];
    await checkFrameBindings(applications, records, lookup, unchecked);
    for (const workspace of workspaces) {
      await checkWorkspacePanel(workspace, applications, records, options, unchecked);
    }
    const references = [
      ["panel", new Set([application.framePanelId, ...application.panelUses.map(use => use.panelId), ...application.delivery?.panels ?? []])],
      ["projection", new Set(application.delivery?.projections)],
    ];
    for (const [kind, ids] of references) {
      for (const id of ids) {
        if (id === undefined || records.get(kind).has(id) || unchecked.some(item => item.kind === kind && item.id === id)) continue;
        const record = await lookup?.(kind, id);
        if (record === null) throw new Error(`${resolve(directory, "application.json")}: ${kind} ${id} was not found in the source or on the platform`);
        if (record === undefined) unchecked.push({ kind, id });
      }
    }
    return { status: "valid", version, ...(digest && { digest }), unchecked };
  }
  const loadAuthoring = typeTable && (() => ({ catalogue, typeTable }));
  const workspace = await readPanelWorkspace(
    directory, checks, materialPath, loadAuthoring, loadPackage, loadDomainComponent,
  );
  const material = workspace.panel ? await workspaceRegistration(workspace) : workspace.material;
  const records = new Map(
    panelRegistrationRecords(material, checks).map(([kind, items]) => [
      kind, new Map(items.map(({ id, body }) => [id, body])),
    ]),
  );
  const applications = material.applications ?? [];
  await checkFrameBindings(applications, records, lookup, unchecked);
  await checkWorkspacePanel(workspace, applications, records, options, unchecked);
  return { status: "valid", version, ...(digest && { digest }), unchecked };
}

async function checkFrameBindings(applications, records, lookup, unchecked) {
  for (const { id, input: { framePanelId, panelUses } } of applications) {
    if (!framePanelId) continue;
    const bindings = panelUses.flatMap(({ pageKey, inputs }) =>
      Object.entries(inputs ?? {}).filter(([, source]) => "frameState" in source)
        .map(([name, { frameState }]) => [pageKey, name, frameState]));
    if (!bindings.length) continue;
    const frame = (records.get("panel").get(framePanelId) ?? await lookup?.("panel", framePanelId))?.manifest;
    if (!frame) {
      unchecked.push({ kind: "panel", id: framePanelId, reason: "Frame state bindings require the frame manifest" });
      continue;
    }
    for (const [pageKey, name, stateKey] of bindings) {
      if (!Object.hasOwn(frame.state, stateKey) || frame.state[stateKey].external !== true) {
        throw new Error(`application ${id}: ${pageKey}.inputs.${name} references frameState "${stateKey}" on ${framePanelId}. Declare state.${stateKey} with "external": true in the frame panel.json`);
      }
    }
  }
}

async function checkWorkspacePanel(workspace, applications, records, {
  checks, catalogue, typeTable, lookup, findChartSource, loadPackage, loadDomainComponent,
}, unchecked) {
  const { manifest } = workspace.definition;
  const { descriptorFile } = workspace;
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

  const resolvedReferences = new Map();
  for (const [kind, id] of references.values()) {
    const record = records.get(kind)?.get(id) ?? (lookup && await lookup(kind, id));
    resolvedReferences.set(`${kind}:${id}`, record);
    if (record === null) {
      throw new Error(`${descriptorFile}: ${kind} ${id} was not found in the material or on the platform`);
    } else if (record === undefined) {
      unchecked.push({ kind, id });
    } else if (kind === "projection") {
      const packageName = componentPackageName(record.componentId);
      const release = packageName && await loadPackage?.(packageName);
      const component = domainComponentId(record.componentId)
        ? await loadDomainComponent?.(record.componentId)
        : release
          ? release.components.find(entry => entry.componentId === record.componentId)
          : components.get(record.componentId);
      if (!component) {
        throw new Error(`${descriptorFile}: projection ${id} uses unavailable component ${record.componentId}`);
      }
      checkProjectionData(id, record, component, checks);
      if (typeTable) checkOperations(id, record, typeTable, placements.get(id), manifest.state, checks);
      // A conversation entry's opening sentence named by key is the placing panel's own words, in each language it
      // declares: a reused projection's key counts as much as a new one's.
      if (record.conversationEntry?.prefillKey !== undefined) {
        const missing = checks.missingEntryMessageKeys([record.conversationEntry], workspace.definition.content.messages);
        if (missing.length) {
          const members = placements.get(id).map(([member]) => member).join(", ");
          const where = missing.map(({ locale }) => locale ?? "any locale").join(", ");
          throw new Error(`${descriptorFile}: member ${members} (projection ${id}) prefillKey '${missing[0].key}' is not in content.messages (${where})`);
        }
      }
    }
  }
  const agentChatComponent = checks.AGENT_CHAT_COMPONENT ?? "@ontomato/sdk:AgentChat";
  async function resolveReference(kind, id) {
    const key = `${kind}:${id}`;
    if (!resolvedReferences.has(key)) {
      resolvedReferences.set(key, records.get(kind)?.get(id) ?? await lookup?.(kind, id));
    }
    return resolvedReferences.get(key);
  }

  async function panelContainsAgentChat(panelId, seen = new Set()) {
    if (seen.has(panelId)) return false;
    seen.add(panelId);
    const panelManifest = panelId === workspace.panel?.id ? manifest : (await resolveReference("panel", panelId))?.manifest;
    if (!panelManifest) return undefined;
    let unresolved = false;
    for (const { target } of Object.values(panelManifest.members)) {
      const projections = "projectionId" in target ? [target.projectionId] : target.candidates?.projectionIds ?? [];
      for (const id of projections) {
        const projection = await resolveReference("projection", id);
        if (projection?.componentId === agentChatComponent) return true;
        if (!projection) unresolved = true;
      }
      const panels = "panelId" in target ? [target.panelId] : target.candidates?.panelIds ?? [];
      for (const id of panels) {
        const contains = await panelContainsAgentChat(id, seen);
        if (contains) return true;
        if (contains === undefined) unresolved = true;
      }
    }
    return unresolved ? undefined : false;
  }

  for (const { id: appId, input: { framePanelId, panelUses } } of applications) {
    const frameHasAgentChat = framePanelId === undefined ? false : await panelContainsAgentChat(framePanelId);
    for (const use of panelUses ?? []) {
      if (use.kind === "frame-conversation") {
        checks.frameConversationEntrySchema.parse(use);
        if (frameHasAgentChat === false) {
          throw new Error(`application ${appId}: frame conversation entry requires an application frame containing AgentChat`);
        }
      } else if (await panelContainsAgentChat(use.panelId)) {
        if (frameHasAgentChat) {
          throw new Error(`application ${appId}: Entry '${use.id}' cannot mount AgentChat because the application frame already mounts AgentChat`);
        }
        if (frameHasAgentChat === false && use.pageComposer !== "none") {
          throw new Error(`application ${appId}: panelUse '${use.id}' mounts AgentChat and must set "pageComposer": "none"`);
        }
      }
    }
    if (frameHasAgentChat === undefined) {
      unchecked.push({ kind: "panel", id: framePanelId, reason: "Application entry validation requires the frame's AgentChat placements" });
    }
  }
  for (const [tag, componentId] of Object.entries(manifest.components ?? {})) {
    if (loadDomainComponent) {
      const component = await loadDomainComponent(componentId);
      if (!component) {
        throw new Error(`${descriptorFile}: manifest.components.${tag} references unavailable component ${componentId}`);
      }
    }
  }
}

export function describePanelType(typeTable, id, readName = null) {
  const { objectTypes, resultSchemas, operations: topLevelOperations = [] } = typeTable;
  if (!Object.hasOwn(objectTypes, id)) {
    throw new Error(`Type ${id} is not listed in the author's type table`);
  }
  const { reads = {}, ...metadata } = objectTypes[id];
  const describe = read => ({ ...read, resultSchema: resultSchemas[read.result] });
  if (readName !== null) {
    if (!Object.hasOwn(reads, readName)) {
      throw new Error(`Type ${id} has no read '${readName}'`);
    }
    return { id, read: readName, ...describe(reads[readName]) };
  }
  const targetlessOperations = topLevelOperations
    .filter(operation => Array.isArray(operation.affects) && operation.affects.includes(id))
    .map(operation => ({ ...operation, targetless: true, callTarget: null }));
  const result = {
    id,
    reads: Object.fromEntries(Object.entries(reads).map(([name, read]) => [name, describe(read)])),
    ...metadata,
  };
  if (targetlessOperations.length > 0 || !id.startsWith("platform:") || topLevelOperations.length > 0) {
    result.targetlessOperations = targetlessOperations;
    result.targetlessOperationsHint = targetlessOperations.length > 0
      ? 'Targetless operations (target.source: "none", call with target: null) whose affects include this type. Run `panel type --all` to list all top-level targetless operations.'
      : "No top-level targetless operations declare this type in affects. Run `panel type --all` to list all top-level targetless operations.";
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , directory, sdkFlag, sdkDirectory, typeFlag, typeTableFile, ...extra] = process.argv;
  if (!directory || sdkFlag !== "--sdk-dir" || !sdkDirectory || typeFlag !== "--type-table" || !typeTableFile || extra.length) {
    throw new Error("Usage: node panel-check.mjs <panel-directory> --sdk-dir <installed-release> --type-table <type-table.json>");
  }
  const sdk = await installedPanelSdk(sdkDirectory);
  const typeTable = sdk.checks.platformTypeTableResponseSchema.parse(await readJson(typeTableFile));
  const { unchecked } = await checkPanelWorkspace(directory, { ...sdk, typeTable });
  if (unchecked.length) {
    throw new Error(`${directory}: unchecked references: ${JSON.stringify(unchecked)}`);
  }
  console.log(`${directory}: valid (0 errors, 0 unchecked references)`);
}
