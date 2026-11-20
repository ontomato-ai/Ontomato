import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { panelRegistrationRecords } from "./panel-registration.mjs";

const text = { kind: "scalar", type: "string" };
const stateRef = state => ({ state });
const inputRef = input => ({ input });
const literal = literal => ({ literal });
const namedRead = (source, read, params = {}) => ({ source, read, params });
const slug = value => value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

export function managementPanel(type, checks, typeTable, {
  id = `${slug(type.split(":").at(-1))}-manager`, operations = [], batches = [],
} = {}) {
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error("Application ID must use lowercase letters, digits and hyphens");
  const owner = typeTable.objectTypes[type];
  const reads = owner?.reads;
  const listRead = reads?.query?.result === "panelRecordQuery" ? "query" : "list";
  const list = reads?.[listRead];
  if (list?.source !== "type" || list.parameterMode !== "fixed" || !["panelRecordList", "panelRecordQuery"].includes(list.result)) {
    throw new Error(`${type} has no declared management list read`);
  }
  const save = `${type}.save`;
  const registered = new Map((owner.operations ?? []).map(operation => [operation.id, operation]));
  const buttons = [];
  for (const [ids, batch] of [[new Set(operations), false], [new Set(batches), true]]) {
    for (const operationId of ids) {
      const operation = registered.get(operationId);
      if (!operation) throw new Error(`${type} does not declare operation ${operationId}`);
      if (operationId === save && !batch) continue;
      if (operation.effect !== "write" || operation.target.source !== "input" || operation.inputSchema.required?.length) {
        throw new Error(`${operationId} requires an authored form or operation inputs`);
      }
      if (batch && !operation.batch) throw new Error(`${operationId} does not support batch execution`);
      buttons.push({ operation, batch });
    }
  }

  const title = type.split(":").at(-1).replace(/([a-z0-9])([A-Z])/gu, "$1 $2");
  const object = { kind: "object", objectType: type };
  const platformType = type.startsWith("platform:");
  const typeSource = { type: { kind: platformType ? "PlatformObjectType" : "ObjectType", id: type } };
  const selectedSource = { object: inputRef("item") };
  const state = { selected: { type: object, deepLink: true } };
  const members = {};
  const events = {};
  const projections = [];
  function place(key, component, { inputs = {}, outputs = {}, config = {}, data = {} }, bindings = {}) {
    const projectionId = `${id}-${key}`;
    projections.push({
      id: projectionId,
      mode: "create",
      input: { name: `${title} ${key}`, description: "", visibility: "domain",
        componentId: `@ontomato/sdk:${component}`, inputs, outputs, config, data },
    });
    members[key] = { target: { projectionId }, ...bindings };
  }

  const search = Object.hasOwn(list.params, "search");
  const counts = reads.counts;
  const tabs = Object.hasOwn(list.params, "status") && counts?.result === "panelGroupCounts" &&
    counts.parameterMode === "fixed" && Object.hasOwn(counts.params, "by") &&
    checks.panelReadParameterSchemas[counts.params.by].safeParse("status").success;
  const listInputs = {};
  const listOutputs = { selected: object };
  const outputs = { selected: stateRef("selected") };
  const selection = { kind: "list", items: object };
  if (buttons.some(({ batch }) => batch)) {
    state.checked = { type: selection, default: [] };
    listOutputs.checked = selection;
    outputs.checked = stateRef("checked");
  }
  if (search) {
    state.search = { type: text, deepLink: true };
    listInputs.search = text;
    listOutputs.search = text;
    outputs.search = stateRef("search");
  }
  if (tabs) {
    const status = checks.panelReadParameterSchemas[list.params.status];
    state.status = { type: text, deepLink: true, ...(status.safeParse("all").success && { default: "all" }) };
    listInputs.status = text;
    const shareSearch = search && Object.hasOwn(counts.params, "search");
    place("tabs", "SegmentedControl", {
      inputs: shareSearch ? { search: text } : {},
      outputs: { value: text },
      data: { counts: namedRead(typeSource, "counts", { by: literal("status") }) },
    }, {
      outputs: { value: stateRef("status") },
      ...(shareSearch && { inputs: { search: stateRef("search") } }),
    });
  }
  place("list", "ObjectList", {
    inputs: listInputs, outputs: listOutputs, data: { rows: namedRead(typeSource, listRead) },
  }, { outputs, ...(tabs && { inputs: { status: stateRef("status") } }) });

  if (reads.record?.result === "panelRecord") {
    const shareSearch = search && reads.record.parameterMode === "fixed" && Object.hasOwn(reads.record.params, "search");
    place("detail", "ObjectSummary", {
      inputs: { item: object, ...(shareSearch && { search: text }) },
      data: { record: namedRead(selectedSource, "record") },
    }, { inputs: { item: stateRef("selected"), ...(shareSearch && { search: stateRef("search") }) } });
  }
  const edit = registered.get(save)?.effect === "write" && reads.form?.result === "panelFormDescription";
  const create = edit && reads.createForm?.result === "panelFormDescription";
  if (operations.includes(save) && !edit) throw new Error(`${save} has no declared form read`);
  if (edit) {
    place("form", "ObjectForm", {
      inputs: { item: object },
      data: { form: namedRead(selectedSource, "form"), ...(create && { createForm: namedRead(typeSource, "createForm") }) },
    }, { inputs: { item: stateRef("selected") } });
  }
  if (create) {
    state.newAction = { type: text };
    place("newRecord", "SegmentedControl", {
      outputs: { value: text }, config: { options: [{ value: "new", label: "New" }] },
    }, { outputs: { value: stateRef("newAction") } });
    events.newRecord = {
      on: { member: "newRecord", output: "value" },
      do: { set: { fields: { selected: literal(null), newAction: literal(null) } } },
    };
  }

  const buttonKeys = buttons.map(({ operation, batch }, index) => {
    const key = `${batch ? "batch" : "action"}${index + 1}`;
    const input = operation.target.input;
    const source = { operation: { kind: platformType ? "PlatformOperation" : "Action", id: operation.id } };
    const params = platformType ? {} : { target: inputRef(input) };
    place(key, "OperationButton", {
      inputs: { [input]: batch ? selection : object },
      data: { operation: namedRead(source, "describe", params) },
    }, { inputs: { [input]: stateRef(batch ? "checked" : "selected") } });
    return key;
  });
  const member = (ref, indent) => `${" ".repeat(indent)}<panel-member ref="${ref}"></panel-member>`;
  const toolbar = ["newRecord", "tabs", ...buttonKeys].filter(key => key in members);
  const detail = ["detail", "form"].filter(key => key in members);
  const html = [
    '<section flow="column" gap="medium" fill="height">',
    ...(toolbar.length ? [
      '  <section flow="row" gap="small">',
      ...toolbar.map(key => member(key, 4)),
      "  </section>",
    ] : []),
    '  <section flow="row" gap="medium" fill="height">',
    member("list", 4),
    ...(detail.length ? [
      '    <section flow="column" gap="medium">',
      ...detail.map(key => member(key, 6)),
      "    </section>",
    ] : []),
    "  </section>",
    "</section>",
    "",
  ].join("\n");
  const manifest = { state, members, events };
  const definition = { manifest, content: { html } };
  checks.panelDefinitionContentSchema.parse(definition);
  const entry = `/applications/${id}`;
  const material = {
    projections,
    panels: [{ id, mode: "create", input: { name: title, description: "", visibility: "domain", ...definition } }],
    applications: [{
      id, mode: "create", input: {
        entry: { path: entry, renderer: "panels" },
        entryAccess: ["domain-member"],
        declaration: { names: { en: title }, descriptions: { en: `Manage ${title}` }, icon: "settings", groups: [], permissions: [] },
        panelUses: [{ id: `${id}-use`, pageKey: id, panelId: id, path: `${entry}/manage`, access: { kind: "domain-member" }, names: { en: title } }],
      },
    }],
  };
  panelRegistrationRecords(material, checks);
  return { html, manifest, material };
}

export async function writeManagementPanel(directory, { html, manifest, material }) {
  await mkdir(directory);
  const json = value => JSON.stringify(value, null, 2) + "\n";
  await Promise.all([
    writeFile(join(directory, "panel.html"), html),
    writeFile(join(directory, "panel.json"), json({ manifest })),
    writeFile(join(directory, "registration.json"), json(material)),
  ]);
}
