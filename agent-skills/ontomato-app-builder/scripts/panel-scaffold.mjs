import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expandInlineProjections } from "./panel-check.mjs";
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
  const catalogState = {};
  const catalogMembers = {};
  const detailState = { selected: { type: object, deepLink: true } };
  const detailMembers = {};

  const search = Object.hasOwn(list.params, "search");
  const counts = reads.counts;
  const tabs = Object.hasOwn(list.params, "status") && counts?.result === "panelGroupCounts" &&
    counts.parameterMode === "fixed" && Object.hasOwn(counts.params, "by") &&
    checks.panelReadParameterSchemas[counts.params.by].safeParse("status").success;
  const listBindings = {};
  if (buttons.some(({ batch }) => batch)) {
    catalogState.checked = { type: { kind: "list", items: object }, default: [] };
    listBindings.checked = "checked";
  }
  if (search) {
    catalogState.search = { type: text, deepLink: true };
    listBindings.search = "search";
  }
  if (tabs) {
    const status = checks.panelReadParameterSchemas[list.params.status];
    catalogState.status = { type: text, deepLink: true, ...(status.safeParse("all").success && { default: "all" }) };
    listBindings.status = "status";
    const shareSearch = search && Object.hasOwn(counts.params, "search");
    catalogMembers.tabs = {
      component: "SegmentedControl",
      type,
      data: { counts: { read: "counts", params: { by: { literal: "status" } } } },
      state: { value: "status", ...(shareSearch && { search: "search" }) },
    };
  }
  catalogMembers.list = { component: "ObjectList", type, data: { rows: listRead }, state: listBindings };

  const record = reads.record?.result === "panelRecord";
  const shareSearch = record && search && reads.record.parameterMode === "fixed" && Object.hasOwn(reads.record.params, "search");
  if (shareSearch) detailState.search = catalogState.search;
  if (record) {
    const target = {
      target: "selected", data: { record: "record" },
      ...(shareSearch && { state: { search: "search" } }),
    };
    detailMembers.header = { component: "ObjectHeader", ...target, config: { subtitle: "" } };
    detailMembers.detail = { component: "ObjectSummary", ...target, config: { showTitle: false } };
  }
  const edit = save?.effect === "write" && reads.form?.result === "panelFormDescription";
  const create = edit && reads.createForm?.result === "panelFormDescription";
  if (requestedSaves.length && !edit) throw new Error(`${save.id} has no declared form read`);
  if (create) {
    catalogState.creating = { type: { kind: "scalar", type: "boolean" }, default: false, deepLink: false };
    catalogMembers.createForm = {
      component: "ObjectForm", type, data: { createForm: "createForm" },
      operation: save.id, config: { actions: "create-only", presentation: "cards" },
    };
  }
  if (edit) {
    detailMembers.form = {
      component: "ObjectForm", target: "selected",
      data: { form: "form" }, operation: save.id, config: { actions: "none" },
    };
  }
  const singleButtons = [];
  const batchButtons = [];
  buttons.forEach(({ operation, batch }, index) => {
    const key = `${batch ? "batch" : "action"}${index + 1}`;
    (batch ? catalogMembers : detailMembers)[key] = {
      component: "OperationButton",
      operation: operation.id,
      target: batch ? "checked" : "selected",
    };
    if (batch) batchButtons.push(key);
    else singleButtons.push(key);
  });

  const root = `/applications/${id}`;
  const catalogPath = `${root}/catalog`;
  const detailPath = `${root}/detail`;
  const member = (key, attrs = "") => `<projection slot="${key}"${attrs}></projection>`;
  const toolbar = [...(tabs ? [member("tabs")] : []), ...batchButtons.map(key => member(key))];

  const catalogHtml = [
    "<style>",
    "  .catalog-page { display: flex; flex-direction: column; min-width: 0; min-height: 100%; }",
    "  .catalog-view { display: flex; flex-direction: column; gap: var(--spacing-md); min-width: 0; padding: var(--spacing-lg) var(--page-gutter) var(--page-content-gap); }",
    ...(toolbar.length ? ["  .catalog-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); }"] : []),
    ...(create ? [
      "  .create-dialog-body .sdk-owner-form, .create-dialog-body .sdk-owner-form-inner { height: auto; }",
      "  .create-dialog-body .sdk-owner-form-body { overflow: visible; }",
    ] : []),
    "</style>",
    '<div id="app">',
    '  <section class="catalog-page">',
    "    <page-header :title=\"t('panel.name')\">",
    ...(create ? [
      "      <template #actions>",
      '        <sdk-button type="primary" @click="creating = true">{{ t("command.new") }}</sdk-button>',
      "      </template>",
    ] : []),
    "    </page-header>",
    '    <div class="catalog-view">',
    ...(toolbar.length ? ['      <div class="catalog-toolbar">', ...toolbar.map(control => `        ${control}`), "      </div>"] : []),
    `      ${member("list", ' @choose="openDetail"')}`,
    "    </div>",
    ...(create ? [
      '    <sdk-dialog v-model="creating" :title="t(\'command.new\')" width="540px" append-to-body destroy-on-close>',
      '      <div class="create-dialog-body">',
      '        <projection slot="createForm" v-if="creating" @saved="onCreated" @cancel="creating = false">',
      '          <template #default="{ groups }">',
      '            <object-form-fields :exclude="groups.flatMap(group => group.fields.filter(field => !field.required).map(field => field.path))"></object-form-fields>',
      '          </template>',
      '        </projection>',
      "      </div>",
      "    </sdk-dialog>",
    ] : []),
    "  </section>",
    "</div>",
    "",
  ].join("\n");

  const catalogModule = [
    ...(create ? ['import { computed } from "vue";'] : []),
    'import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";',
    "",
    `const DETAIL_PATH = "${detailPath}";`,
    "",
    "await mountPanel({",
    "  setup() {",
    `    const { ${create || shareSearch ? "instance, " : ""}navigate } = usePanelContext();`,
    "    function openDetail({ primaryKey }) {",
    `      return navigate(panelAddress(DETAIL_PATH, { selected: primaryKey${shareSearch ? ", search: instance.state.values.value.search" : ""} }));`,
    "    }",
    ...(create ? [
      "    const creating = computed({",
      '      get: () => instance.state.values.value.creating,',
      '      set: (open) => instance.state.set("creating", open),',
      "    });",
      "    function onCreated(target) {",
      "      creating.value = false;",
      "      if (target.primaryKey !== null) return openDetail(target);",
      "    }",
    ] : []),
    `    return { openDetail${create ? ", creating, onCreated" : ""} };`,
    "  },",
    "});",
    "",
  ].join("\n");

  const detailHtml = [
    "<style>",
    "  .detail-page { display: flex; flex-direction: column; min-width: 0; min-height: 100%; container: detail-page / inline-size; }",
    `  .detail-body { display: grid; grid-template-columns: ${record && edit ? "minmax(320px, 0.85fr) minmax(420px, 1.15fr)" : "minmax(0, 1fr)"}; gap: var(--page-content-gap); padding: var(--page-content-gap) var(--page-gutter); }`,
    "  .detail-card { min-width: 0; padding: var(--page-section-padding, var(--spacing-lg)); border: 1px solid var(--sdk-border-color, var(--ui-border)); border-radius: var(--radius-md); }",
    "  @container detail-page (max-width: 850px) { .detail-body { grid-template-columns: minmax(0, 1fr); } }",
    "</style>",
    '<div id="app">',
    '  <section class="detail-page">',
    `    <page-header :back-label="t('detail.back')"${edit ? ' :draft="formDraft"' : ""} @back="goBack">`,
    "      <template #title>",
    ...(record ? [`        ${member("header", ' v-if="selectedKey" :fallback-title="selectedKey"')}`, '        <span v-else>{{ t("detail.choose") }}</span>']
      : ['        <span>{{ selectedKey ?? t("detail.choose") }}</span>']),
    "      </template>",
    ...(singleButtons.length ? [
      "      <template #actions>",
      ...singleButtons.map(key => `        ${member(key, record ? ' v-show="selectedKey && ready"' : ' v-show="selectedKey"')}`),
      "      </template>",
    ] : []),
    "    </page-header>",
    ...(record || edit ? [
      `    <div v-if="selectedKey${record ? " && ready" : ""}" class="detail-body">`,
      ...[...(edit ? ["form"] : []), ...(record ? ["detail"] : [])].map(key =>
        `      <section class="detail-card">${member(key)}</section>`),
      "    </div>",
    ] : []),
    ...(record ? [
      '    <template v-else-if="selectedKey">',
      '      <sdk-alert v-if="!status || status === \'awaiting\' || status === \'loading\'" type="info" :closable="false" :title="t(\'detail.loading\')"></sdk-alert>',
      '      <sdk-alert v-else-if="status === \'forbidden\'" type="warning" :closable="false" :title="t(\'detail.forbidden\')"></sdk-alert>',
      '      <sdk-alert v-else-if="status === \'error\'" type="error" :closable="false" :title="t(\'detail.error\')"></sdk-alert>',
      '      <sdk-alert v-else type="warning" :closable="false" :title="t(\'detail.missing\')"></sdk-alert>',
      "    </template>",
    ] : []),
    "  </section>",
    "</div>",
    "",
  ].join("\n");

  const imports = ["mountPanel", "usePanelContext", ...(edit ? ["usePanelFormDraft"] : []), ...(record ? ["usePanelOutput"] : [])];
  const detailModule = [
    'import { computed } from "vue";',
    `import { ${imports.join(", ")} } from "@ontomato/sdk/panel";`,
    "",
    `const CATALOG_PATH = "${catalogPath}";`,
    "",
    "await mountPanel({",
    "  setup() {",
    "    const { instance, navigate } = usePanelContext();",
    "    const selectedKey = computed(() => instance.state.values.value.selected?.primaryKey);",
    ...(record ? [
      '    const status = usePanelOutput("header", "status");',
      '    const ready = computed(() => status.value === "ready");',
    ] : []),
    ...(edit ? [`    const formDraft = usePanelFormDraft("form", { when: ${record ? "ready" : "selectedKey"} });`] : []),
    `    return { selectedKey${record ? ", status, ready" : ""}${edit ? ", formDraft" : ""}, goBack: () => navigate(CATALOG_PATH) };`,
    "  },",
    "});",
    "",
  ].join("\n");

  function panel(entry, html, module, state, members, messages) {
    const manifest = { state, members };
    return {
      id: `${id}-${entry}`, html, module,
      descriptor: { name: `${title} (${entry})`, description: "", visibility: "domain", manifest, content: { messages: { en: messages } } },
    };
  }

  const catalog = panel("catalog", catalogHtml, catalogModule, catalogState, catalogMembers, {
    "panel.name": title,
    ...(create && { "command.new": `New ${title}` }),
  });
  const detail = panel("detail", detailHtml, detailModule, detailState, detailMembers, {
    "detail.back": `Back to ${title}`,
    "detail.choose": `Choose a ${title}`,
    ...(record && {
      "detail.loading": "Loading the record…",
      "detail.forbidden": "You don't have permission to view this record.",
      "detail.error": "The record could not be loaded.",
      "detail.missing": "The record is missing.",
    }),
  });
  const use = (entry, path) => ({
    id: `${id}-${entry}-use`, pageKey: `${id}-${entry}`, panelId: `${id}-${entry}`, path,
    access: { kind: "domain-member" },
  });
  const application = {
    entry: { path: catalogPath, renderer: "panels" },
    entryAccess: ["domain-member"],
    declaration: { names: { en: title }, descriptions: { en: `Manage ${title}` }, icon: "app-window", groups: [], permissions: [] },
    panelUses: [{ ...use("catalog", catalogPath), names: { en: title } }, use("detail", detailPath)],
  };
  return { application, panels: [catalog, detail], entry: catalogPath };
}

export async function writeManagementPanel(directory, { application, panels }, checks, authoring) {
  const sources = await Promise.all(panels.map(async ({ id, html, module, descriptor }) => {
    const path = join(directory, "panels", id);
    const { manifest, inline } = await expandInlineProjections(
      join(path, "panel.json"), descriptor.manifest, { id }, checks, () => authoring,
    );
    return { path, html, module, descriptor: { ...descriptor, manifest }, projections: inline };
  }));
  await mkdir(directory);
  const json = value => JSON.stringify(value, null, 2) + "\n";
  const projectionsDir = join(directory, "projections");
  await mkdir(projectionsDir);
  await writeFile(join(directory, "application.json"), json(application));
  await Promise.all(sources.map(async ({ path, html, module, descriptor, projections }) => {
    await mkdir(path, { recursive: true });
    await Promise.all([
      writeFile(join(path, "panel.html"), html),
      writeFile(join(path, "panel.mjs"), module),
      writeFile(join(path, "panel.json"), json(descriptor)),
      ...projections.map(({ id, member, input }) => writeFile(join(projectionsDir, `${id}.json`), json({
        ...input, name: input.name ?? member, description: input.description ?? member, visibility: descriptor.visibility,
      }))),
    ]);
  }));
}
