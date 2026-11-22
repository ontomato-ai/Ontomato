import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireApplicationId } from "./panel-registration.mjs";

const text = { kind: "scalar", type: "string" };
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
  const state = { selected: { type: object, deepLink: true } };
  const members = {};
  const commands = {};

  const search = Object.hasOwn(list.params, "search");
  const counts = reads.counts;
  const tabs = Object.hasOwn(list.params, "status") && counts?.result === "panelGroupCounts" &&
    counts.parameterMode === "fixed" && Object.hasOwn(counts.params, "by") &&
    checks.panelReadParameterSchemas[counts.params.by].safeParse("status").success;
  const listBindings = { selected: "selected" };
  if (buttons.some(({ batch }) => batch)) {
    state.checked = { type: { kind: "list", items: object }, default: [] };
    listBindings.checked = "checked";
  }
  if (search) {
    state.search = { type: text, deepLink: true };
    listBindings.search = "search";
  }
  if (tabs) {
    const status = checks.panelReadParameterSchemas[list.params.status];
    state.status = { type: text, deepLink: true, ...(status.safeParse("all").success && { default: "all" }) };
    listBindings.status = "status";
    const shareSearch = search && Object.hasOwn(counts.params, "search");
    members.tabs = {
      component: "SegmentedControl",
      type,
      data: { counts: { read: "counts", params: { by: { literal: "status" } } } },
      state: { value: "status", ...(shareSearch && { search: "search" }) },
    };
  }
  members.list = { component: "ObjectList", type, data: { rows: listRead }, state: listBindings };

  if (reads.record?.result === "panelRecord") {
    const shareSearch = search && reads.record.parameterMode === "fixed" && Object.hasOwn(reads.record.params, "search");
    members.detail = {
      component: "ObjectSummary", target: "selected", data: { record: "record" },
      ...(shareSearch && { state: { search: "search" } }),
    };
  }
  const edit = save?.effect === "write" && reads.form?.result === "panelFormDescription";
  const create = edit && reads.createForm?.result === "panelFormDescription";
  if (requestedSaves.length && !edit) throw new Error(`${save.id} has no declared form read`);
  if (create) {
    state.creating = { type: { kind: "scalar", type: "boolean" }, default: false, deepLink: true };
    commands.create = {
      labelKey: "command.new",
      primary: true,
      do: { set: { fields: { creating: { literal: true }, selected: { literal: null } } } },
    };
  }
  if (edit) {
    members.form = {
      component: "ObjectForm", target: "selected",
      data: { form: "form", ...(create && { createForm: "createForm" }) },
      operation: save.id,
    };
  }
  const buttonKeys = buttons.map(({ operation, batch }, index) => {
    const key = `${batch ? "batch" : "action"}${index + 1}`;
    members[key] = { component: "OperationButton", operation: operation.id, target: batch ? "checked" : "selected" };
    return key;
  });
  const member = (key, attrs = "") => `<projection slot="${key}"${attrs}></projection>`;
  const controls = [...(tabs ? [member("tabs")] : []), ...buttonKeys.map(key => member(key))];
  const details = [
    ...(members.detail ? [member("detail", ' v-if="selected"')] : []),
    ...(edit ? [member("form", create ? ' v-show="selected || creating" @saved="stopCreating" @discarded="stopCreating"' : ' v-show="selected"')] : []),
  ];
  const html = [
    "<style>",
    "  .management { display: flex; flex-direction: column; height: 100%; min-height: 24rem; }",
    ...(controls.length ? ["  .management-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--ui-divider); }"] : []),
    "  .management-body { display: grid; flex: 1; min-height: 0; }",
    ...(details.length ? [
      "  .management-columns { grid-template-columns: minmax(0, var(--pane-list-width, 300px)) minmax(0, 1fr); }",
      "  .management-columns.is-narrow { grid-template-columns: minmax(0, 1fr); }",
      "  .management-list, .management-detail { min-height: 0; overflow: auto; padding: var(--spacing-md); }",
      "  .management-columns:not(.is-narrow) .management-list { border-right: 1px solid var(--ui-divider); }",
      "  .management-detail { display: flex; flex-direction: column; gap: var(--spacing-md); }",
      "  .management-back { align-self: flex-start; }",
    ] : ["  .management-list { min-height: 0; overflow: auto; padding: var(--spacing-md); }"]),
    "</style>",
    '<div id="app">',
    `  <section${details.length ? ' ref="rootRef"' : ""} class="management">`,
    ...(controls.length ? ['    <div class="management-toolbar">', ...controls.map(control => `      ${control}`), "    </div>"] : []),
    `    <div class="management-body${details.length ? ' management-columns" :class="{ \'is-narrow\': narrow }"' : '"'}>`,
    `      <div class="management-list"${details.length ? ' v-show="!narrow || !hasDetail"' : ""}>`,
    `        ${member("list", create ? ' @update:selected="stopCreating"' : "")}`,
    "      </div>",
    ...(details.length ? [
      '      <div class="management-detail" v-show="!narrow || hasDetail">',
      '        <div v-if="narrow && hasDetail" class="management-back">',
      '          <sdk-button size="small" @click="back">{{ t("action.back") }}</sdk-button>',
      "        </div>",
      ...details.map(detail => `        ${detail}`),
      "      </div>",
    ] : []),
    "    </div>",
    "  </section>",
    "</div>",
    "",
  ].join("\n");
  const module = details.length ? [
    `import { computed, ref${create ? ", watch" : ""} } from "vue";`,
    'import { mountPanel, usePanelBack, usePanelContext, usePanelNarrow } from "@ontomato/sdk/panel";',
    "",
    "await mountPanel({",
    "  setup() {",
    "    const { instance } = usePanelContext();",
    "    const rootRef = ref(null);",
    "    const narrow = usePanelNarrow(rootRef);",
    "    const selected = computed(() => instance.state.values.value.selected);",
    ...(create ? [
      "    const creating = computed(() => Boolean(instance.state.values.value.creating));",
      "    const hasDetail = computed(() => Boolean(selected.value || creating.value));",
      "    watch(instance.draft, draft => {",
      '      if (draft && !selected.value && !creating.value) instance.state.set("creating", true);',
      "    }, { immediate: true });",
      "    function stopCreating() {",
      '      if (creating.value) instance.state.set("creating", false);',
      "    }",
      "    function closeDetail() {",
      "      instance.state.setState({ selected: null, creating: false });",
      "    }",
      "    const { back } = usePanelBack(() => narrow.value && hasDetail.value, closeDetail);",
      "    return { rootRef, narrow, selected, creating, hasDetail, stopCreating, back };",
    ] : [
      "    const hasDetail = computed(() => Boolean(selected.value));",
      "    function closeDetail() {",
      '      instance.state.set("selected", null);',
      "    }",
      "    const { back } = usePanelBack(() => narrow.value && hasDetail.value, closeDetail);",
      "    return { rootRef, narrow, selected, hasDetail, back };",
    ]),
    "  },",
    "});",
    "",
  ].join("\n") : 'import { mountPanel } from "@ontomato/sdk/panel";\n\nawait mountPanel({});\n';
  const manifest = { state, members, commands };
  checks.panelAuthoringManifestSchema.parse(manifest);
  const messages = {
    "panel.name": title,
    ...(create && { "command.new": "New" }),
    ...(details.length && { "action.back": "Back" }),
  };
  const content = { messages: { en: messages } };
  const entry = `/applications/${id}`;
  const material = {
    panels: [{ id, mode: "create", input: { name: title, description: "", visibility: "domain" } }],
    applications: [{
      id, mode: "create", input: {
        entry: { path: entry, renderer: "panels" },
        entryAccess: ["domain-member"],
        declaration: { names: { en: title }, descriptions: { en: `Manage ${title}` }, icon: "app-window", groups: [], permissions: [] },
        panelUses: [{ id: `${id}-use`, pageKey: id, panelId: id, path: `${entry}/manage`, access: { kind: "domain-member" }, names: { en: title } }],
      },
    }],
  };
  return { html, module, manifest, content, material };
}

export async function writeManagementPanel(directory, { html, module, manifest, content, material }) {
  await mkdir(directory);
  const json = value => JSON.stringify(value, null, 2) + "\n";
  await Promise.all([
    writeFile(join(directory, "panel.html"), html),
    writeFile(join(directory, "panel.mjs"), module),
    writeFile(join(directory, "panel.json"), json({ manifest, ...(content && { content }) })),
    writeFile(join(directory, "registration.json"), json(material)),
  ]);
}
