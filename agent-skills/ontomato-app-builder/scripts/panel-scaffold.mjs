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
      config: { showTitle: false },
      ...(shareSearch && { state: { search: "search" } }),
    };
  }
  const edit = save?.effect === "write" && reads.form?.result === "panelFormDescription";
  const create = edit && reads.createForm?.result === "panelFormDescription";
  if (requestedSaves.length && !edit) throw new Error(`${save.id} has no declared form read`);
  if (create) {
    state.creating = { type: { kind: "scalar", type: "boolean" }, default: false, deepLink: true };
  }
  if (edit) {
    members.form = {
      component: "ObjectForm", target: "selected",
      data: { form: "form", ...(create && { createForm: "createForm" }) },
      operation: save.id,
      config: { actions: create ? "create-only" : "none" },
    };
  }
  const singleButtons = [];
  const batchButtons = [];
  buttons.forEach(({ operation, batch }, index) => {
    const key = `${batch ? "batch" : "action"}${index + 1}`;
    members[key] = {
      component: "OperationButton",
      operation: operation.id,
      target: batch ? "checked" : "selected",
    };
    if (batch) batchButtons.push(key);
    else singleButtons.push(key);
  });

  const member = (key, attrs = "") => `<projection slot="${key}"${attrs}></projection>`;
  const toolbarControls = [...(tabs ? [member("tabs")] : []), ...batchButtons.map(key => member(key))];
  const hasDetail = Boolean(members.detail || edit || singleButtons.length);
  const twoCards = Boolean(members.detail && edit);

  const html = [
    "<style>",
    "  .catalog-page { display: flex; flex-direction: column; min-width: 0; min-height: 100%; container: catalog-page / inline-size; }",
    "  .catalog-view { display: flex; flex-direction: column; gap: var(--spacing-md); min-width: 0; padding: var(--spacing-lg) var(--page-gutter) var(--page-content-gap); }",
    ...(toolbarControls.length ? ["  .catalog-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); }"] : []),
    ...(hasDetail ? [
      "  .detail-view { display: flex; flex-direction: column; min-width: 0; min-height: 100%; }",
      `  .detail-body { display: grid; grid-template-columns: ${twoCards ? "minmax(320px, 0.85fr) minmax(420px, 1.15fr)" : "minmax(0, 1fr)"}; gap: var(--page-content-gap); padding: var(--page-content-gap) var(--page-gutter); align-items: stretch; }`,
      "  .detail-card { display: flex; flex-direction: column; gap: var(--spacing-md); min-width: 0; padding: var(--page-section-padding, var(--spacing-lg)); border: 1px solid var(--sdk-border-color, var(--ui-border)); border-radius: var(--radius-md); background: var(--sdk-bg-color); }",
      "  .detail-card h2 { margin: 0; color: var(--sdk-text-color-primary); font-size: var(--text-lg); font-weight: var(--font-semibold); }",
      ...(create ? [
        "  .create-dialog-body .sdk-owner-form, .create-dialog-body .sdk-owner-form-inner { height: auto; }",
        "  .create-dialog-body .sdk-owner-form-body { overflow: visible; }",
      ] : []),
      "  @container catalog-page (max-width: 850px) { .detail-body { grid-template-columns: minmax(0, 1fr); } }",
    ] : []),
    "</style>",
    '<div id="app">',
    '  <section class="catalog-page">',
    ...(hasDetail ? ['    <template v-if="!selectedKey">'] : []),
    ...(create ? [
      '      <page-header :title="t(\'panel.name\')">',
      '        <template #actions>',
      '          <sdk-button type="primary" :disabled="creating" @click="startCreate">{{ t("command.new") }}</sdk-button>',
      '        </template>',
      '      </page-header>',
    ] : [
      '      <page-header :title="t(\'panel.name\')"></page-header>',
    ]),
    '      <div class="catalog-view">',
    ...(toolbarControls.length ? ['        <div class="catalog-toolbar">', ...toolbarControls.map(control => `          ${control}`), "        </div>"] : []),
    `        ${member("list", create ? ' @update:selected="stopCreating"' : "")}`,
    "      </div>",
    ...(hasDetail ? [
      "    </template>",
      '    <div v-else class="detail-view">',
      ...(singleButtons.length ? [
        `      <page-header :title="selectedTitle" :back-label="t('detail.back')"${edit ? ' :draft="formDraft"' : ""} @back="back">`,
        '        <template #actions>',
        ...singleButtons.map(key => `          ${member(key)}`),
        "        </template>",
        "      </page-header>",
      ] : [
        `      <page-header :title="selectedTitle" :back-label="t('detail.back')"${edit ? ' :draft="formDraft"' : ""} @back="back"></page-header>`,
      ]),
      '      <div class="detail-body">',
      ...(edit ? [
        '        <section class="detail-card">',
        '          <h2>{{ t("detail.basicInfo") }}</h2>',
        `          ${member("form", ' @saved="onSaved" @discarded="onDiscarded"')}`,
        "        </section>",
      ] : []),
      ...(members.detail ? [
        '        <section class="detail-card">',
        '          <h2>{{ t("detail.overview") }}</h2>',
        `          ${member("detail")}`,
        "        </section>",
      ] : []),
      "      </div>",
      "    </div>",
    ] : []),
    ...(create ? [
      '    <sdk-dialog v-model="createDialog" :title="t(\'dialog.createTitle\')" width="540px" append-to-body destroy-on-close>',
      '      <div class="create-dialog-body">',
      `        ${member("form", ' v-if="createDialog" @saved="onSaved" @discarded="onDiscarded" @cancel="cancelCreate"')}`,
      "      </div>",
      "    </sdk-dialog>",
    ] : []),
    "  </section>",
    "</div>",
    "",
  ].join("\n");

  const sdkImports = [
    "mountPanel",
    "usePanelBack",
    "usePanelContext",
    ...(edit ? ["usePanelFormDraft"] : []),
  ];

  const module = hasDetail ? [
    'import { computed } from "vue";',
    `import { ${sdkImports.join(", ")} } from "@ontomato/sdk/panel";`,
    "",
    `const TYPE = ${JSON.stringify(type)};`,
    "",
    "await mountPanel({",
    "  setup() {",
    "    const { instance } = usePanelContext();",
    "    const selected = computed(() => instance.state.values.value.selected);",
    '    const selectedKey = computed(() => (selected.value ? selected.value.primaryKey : ""));',
    "    const selectedTitle = computed(() => {",
    "      const key = selectedKey.value;",
    '      if (!key) return "";',
    "      const match = instance.pageContext.value.selection.find(item => item.id === key);",
    "      return match?.label || key;",
    "    });",
    ...(create ? [
      "    const creating = computed(() => instance.state.values.value.creating === true);",
      "    const createDialog = computed({",
      "      get: () => creating.value && !selectedKey.value,",
      "      set: value => {",
      "        if (!value && creating.value) cancelCreate();",
      "      },",
      "    });",
      "    function startCreate() {",
      "      instance.state.setState({ creating: true, selected: null });",
      "    }",
      "    function stopCreating() {",
      '      if (creating.value) instance.state.set("creating", false);',
      "    }",
      "    function cancelCreate() {",
      "      instance.state.setState({ creating: false, selected: null });",
      "    }",
    ] : []),
    ...(edit ? [
      '    const formDraft = usePanelFormDraft("form", { when: () => Boolean(selectedKey.value) });',
      "    function onSaved(saved) {",
      ...(create ? ['      instance.state.set("creating", false);'] : []),
      '      instance.state.set("selected", { className: saved.className || TYPE, primaryKey: saved.primaryKey });',
      "    }",
      "    function onDiscarded() {",
      ...(create ? ['      instance.state.set("creating", false);'] : []),
      "    }",
    ] : []),
    "    function backToCatalog() {",
    ...(create ? ["      instance.state.setState({ selected: null, creating: false });"] : ['      instance.state.set("selected", null);']),
    "    }",
    `    const { back } = usePanelBack(() => Boolean(selectedKey.value), backToCatalog, { pushHistory: true${edit ? ', forms: "form"' : ""} });`,
    `    return { ${[
      "selectedKey", "selectedTitle", "back",
      ...(create ? ["creating", "createDialog", "startCreate", "stopCreating", "cancelCreate"] : []),
      ...(edit ? ["formDraft", "onSaved", "onDiscarded"] : []),
    ].join(", ")} };`,
    "  },",
    "});",
    "",
  ].join("\n") : 'import { mountPanel } from "@ontomato/sdk/panel";\n\nawait mountPanel({});\n';

  const manifest = { state, members };
  checks.panelAuthoringManifestSchema.parse(manifest);
  const messages = {
    "panel.name": title,
    ...(create && { "command.new": `New ${title}`, "dialog.createTitle": `New ${title}` }),
    ...(hasDetail && { "detail.back": `Back to ${title}` }),
    ...(edit && { "detail.basicInfo": "Basic information" }),
    ...(members.detail && { "detail.overview": "Overview" }),
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
