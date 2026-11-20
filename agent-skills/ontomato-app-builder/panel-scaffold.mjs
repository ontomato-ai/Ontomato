import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { panelRegistrationRecords, requireApplicationId } from "./panel-registration.mjs";

const text = { kind: "scalar", type: "string" };
const stateRef = state => ({ state });
const inputRef = input => ({ input });
const literal = literal => ({ literal });
const namedRead = (source, read, params = {}) => ({ source, read, params });
const slug = value => value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

export function managementPanel(type, checks, typeTable, {
  id = `app-${slug(type.split(":").at(-1))}-manager`, operations = [], batches = [],
} = {}) {
  requireApplicationId(id);
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error("Application ID must use lowercase letters, digits and hyphens");
  const owner = typeTable.objectTypes[type];
  const reads = owner?.reads;
  const listRead = reads?.query?.result === "panelRecordQuery" ? "query" : "list";
  const list = reads?.[listRead];
  if (list?.source !== "type" || list.parameterMode !== "fixed" || !["panelRecordList", "panelRecordQuery"].includes(list.result)) {
    throw new Error(`${type} has no declared management list read`);
  }
  const registered = new Map((owner.operations ?? []).map(operation => [operation.id, operation]));
  const formSaves = [...registered.values()].filter(operation => operation.kind === "form.save");
  const requestedSaves = formSaves.filter(operation => operations.includes(operation.id));
  if (requestedSaves.length > 1) throw new Error(`${type}: select one form save operation`);
  const save = requestedSaves[0] ?? (formSaves.length === 1 ? formSaves[0] : undefined);
  const buttons = [];
  for (const [ids, batch] of [[new Set(operations), false], [new Set(batches), true]]) {
    for (const operationId of ids) {
      const operation = registered.get(operationId);
      if (!operation) throw new Error(`${type} does not declare operation ${operationId}`);
      if (operation.kind === "form.save" && !batch) continue;
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
  const operationKind = platformType ? "PlatformOperation" : "Action";
  const typeSource = { type: { kind: platformType ? "PlatformObjectType" : "ObjectType", id: type } };
  const selectedSource = { object: inputRef("item") };
  const state = { selected: { type: object, deepLink: true } };
  const members = {};
  const projections = [];
  function place(key, component, { inputs = {}, outputs = {}, config = {}, data = {}, operations }, bindings = {}) {
    const projectionId = `${id}-${key}`;
    projections.push({
      id: projectionId,
      mode: "create",
      input: { name: `${title} ${key}`, description: "", visibility: "domain",
        componentId: `@ontomato/sdk:${component}`, inputs, outputs, config, data, ...(operations && { operations }) },
    });
    members[key] = { target: { projectionId }, ...bindings };
  }

  const search = Object.hasOwn(list.params, "search");
  const counts = reads.counts;
  const tabs = Object.hasOwn(list.params, "status") && counts?.result === "panelGroupCounts" &&
    counts.parameterMode === "fixed" && Object.hasOwn(counts.params, "by") &&
    checks.panelReadParameterSchemas[counts.params.by].safeParse("status").success;
  const listInputs = { selected: object };
  const listOutputs = { selected: object };
  const listBindings = { selected: stateRef("selected") };
  const selection = { kind: "list", items: object };
  if (buttons.some(({ batch }) => batch)) {
    state.checked = { type: selection, default: [] };
    listInputs.checked = selection;
    listOutputs.checked = selection;
    listBindings.checked = stateRef("checked");
  }
  if (search) {
    state.search = { type: text, deepLink: true };
    listInputs.search = text;
    listBindings.search = stateRef("search");
  }
  if (tabs) {
    const status = checks.panelReadParameterSchemas[list.params.status];
    state.status = { type: text, deepLink: true, ...(status.safeParse("all").success && { default: "all" }) };
    listInputs.status = text;
    listBindings.status = stateRef("status");
    const shareSearch = search && Object.hasOwn(counts.params, "search");
    place("tabs", "SegmentedControl", {
      inputs: { value: text, ...(shareSearch && { search: text }) },
      outputs: { value: text },
      data: { counts: namedRead(typeSource, "counts", { by: literal("status") }) },
    }, {
      inputs: { value: stateRef("status"), ...(shareSearch && { search: stateRef("search") }) },
    });
  }
  place("list", "ObjectList", {
    inputs: listInputs, outputs: listOutputs, data: { rows: namedRead(typeSource, listRead) },
  }, { inputs: listBindings });

  if (reads.record?.result === "panelRecord") {
    const shareSearch = search && reads.record.parameterMode === "fixed" && Object.hasOwn(reads.record.params, "search");
    place("detail", "ObjectSummary", {
      inputs: { item: object, ...(shareSearch && { search: text }) },
      data: { record: namedRead(selectedSource, "record") },
    }, { inputs: { item: stateRef("selected"), ...(shareSearch && { search: stateRef("search") }) } });
  }
  const edit = save?.effect === "write" && reads.form?.result === "panelFormDescription";
  const create = edit && reads.createForm?.result === "panelFormDescription";
  if (requestedSaves.length && !edit) throw new Error(`${save.id} has no declared form read`);
  if (edit) {
    place("form", "ObjectForm", {
      inputs: { item: object },
      data: { form: namedRead(selectedSource, "form"), ...(create && { createForm: namedRead(typeSource, "createForm") }) },
      operations: { save: { operation: { kind: operationKind, id: save.id }, target: inputRef("item") } },
    }, { inputs: { item: stateRef("selected") } });
  }
  const buttonKeys = buttons.map(({ operation, batch }, index) => {
    const key = `${batch ? "batch" : "action"}${index + 1}`;
    const input = operation.target.input;
    const name = operation.id.split(".").at(-1);
    place(key, "OperationButton", {
      inputs: { [input]: batch ? selection : object },
      operations: { [name]: { operation: { kind: operationKind, id: operation.id }, target: inputRef(input) } },
      config: { operation: name },
    }, { inputs: { [input]: stateRef(batch ? "checked" : "selected") } });
    return key;
  });
  const member = (key, attrs = "") => `<projection slot="${key}"${attrs}></projection>`;
  const controls = [...(create ? ['<button type="button" @click="newRecord">New</button>'] : []),
    ...(tabs ? [member("tabs")] : []), ...buttonKeys.map(key => member(key))];
  const details = [
    ...(members.detail ? [member("detail", ' v-if="selected"')] : []),
    ...(edit ? [member("form", create ? ' v-if="selected || creating"' : ' v-if="selected"')] : []),
  ];
  const html = [
    "<style>",
    "  .management { display: grid; gap: 1rem; }",
    "  .management-toolbar { display: flex; flex-wrap: wrap; gap: .75rem; }",
    "  .management-body { display: grid; gap: 1rem; }",
    "  .management-columns { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); }",
    "  .management-detail { display: grid; gap: 1rem; align-content: start; }",
    "  @media (max-width: 36rem) { .management-columns { grid-template-columns: minmax(0, 1fr); } }",
    "</style>",
    '<div id="app">',
    '  <section class="management">',
    ...(controls.length ? ['    <div class="management-toolbar">', ...controls.map(control => `      ${control}`), "    </div>"] : []),
    `    <div class="management-body${details.length ? " management-columns" : ""}">`,
    `      ${member("list", create ? ' @update:selected="stopCreating"' : "")}`,
    ...(details.length ? ['      <div class="management-detail">', ...details.map(detail => `        ${detail}`), "      </div>"] : []),
    "    </div>",
    "  </section>",
    "</div>",
    "",
  ].join("\n");
  const module = details.length ? [
    `import { computed${create ? ", ref" : ""} } from "vue";`,
    'import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";',
    "",
    "await mountPanel({",
    "  setup() {",
    "    const { instance } = usePanelContext();",
    "    const selected = computed(() => instance.state.values.value.selected);",
    ...(create ? [
      "    const creating = ref(false);",
      "    function newRecord() {",
      "      creating.value = true;",
      '      instance.state.set("selected", null);',
      "    }",
      "    function stopCreating() {",
      "      creating.value = false;",
      "    }",
      "    return { selected, creating, newRecord, stopCreating };",
    ] : ["    return { selected };"]),
    "  },",
    "});",
    "",
  ].join("\n") : 'import { mountPanel } from "@ontomato/sdk/panel";\n\nawait mountPanel({});\n';
  const manifest = { state, members, events: {} };
  const definition = { manifest, content: { html, module } };
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
  return { html, module, manifest, material };
}

export async function writeManagementPanel(directory, { html, module, manifest, material }) {
  await mkdir(directory);
  const json = value => JSON.stringify(value, null, 2) + "\n";
  await Promise.all([
    writeFile(join(directory, "panel.html"), html),
    writeFile(join(directory, "panel.mjs"), module),
    writeFile(join(directory, "panel.json"), json({ manifest })),
    writeFile(join(directory, "registration.json"), json(material)),
  ]);
}
