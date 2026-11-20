import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, defineComponent, h, ref, resolveComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { definePanel, type PanelManifest, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type { PanelFormSaveInput } from "@ontomato/contracts/panel-projection";
import type { PanelHostMessage } from "@ontomato/contracts/panel-host";
import { appsSdkCurrentSchema } from "@ontomato/contracts/apps-sdk";
import type { PanelMemberSnapshot } from "@ontomato/contracts/product-subscriptions";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import {
  platformScheduleFormSchema,
  platformTaskRunSchema,
  platformTaskSchema,
  type PlatformScheduleForm,
  type PlatformTask,
  type PlatformTaskRun,
} from "@ontomato/contracts/platform-schedules";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import ElementPlus from "element-plus";
import type { Router } from "vue-router";
import elementEn from "element-plus/es/locale/lang/en";
import { installAppHost, installProductEmbedding } from "../../../../../packages/platform-web/src/app-host";

import type { ConfirmPanelOperation, PanelHumanOperations } from "../../../../../packages/apps-sdk/src/panel/human-operations";
import { randomId } from "@ontomato/contracts/random-id";
/*
 * A panel's frame inside the platform, for tests that run both ends for real: the platform's own app host and message
 * bridge, as the shell installs them, and on the frame's side the SDK's own modules. Only the browser is stood in for —
 * the frame sees the platform's window the way a sandboxed frame without `allow-same-origin` does — and the network is a
 * recorded `fetch` that answers what a test tells it to.
 */

export const READER = "reader-token";
export const SCHEDULED_TASK = "platform:ScheduledTask";

const HERE = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(HERE, "..", "..", "..", "..", "..", "packages", "contracts", "examples", "platform-schedules.json"), "utf8"),
) as Record<"creates" | "forms" | "runs", { name: string; response: Record<string, unknown> }[]>;
const example = (list: "creates" | "forms" | "runs", name: string) => examples[list].find((entry) => entry.name === name)!.response;

/** The reader's scheduled task: the contract's own operations-diagnosis example, as the trial's test task is. */
export const task: PlatformTask = platformTaskSchema.parse(example("creates", "operations-autotest"));

/** The task's application's form for what the task holds, as the operations application answers it. */
export const taskForm: PlatformScheduleForm = platformScheduleFormSchema.parse({
  ...example("forms", "operations-switch-back-to-autotest"),
  values: task.content,
  submittable: true,
});

/** What the form's changed note names for the case set: the owner's own label for the field. */
export const caseSetLabel = taskForm.fields.find((field) => field.key === "caseSetId")!.label;

export const inspectionTaskForm = platformScheduleFormSchema.parse(example("forms", "operations-switch-to-inspection"));

/** A manual run the service started for the task, as it answers "run now". */
export const run: PlatformTaskRun = platformTaskRunSchema.parse({
  ...example("runs", "agents-running"),
  taskId: task.id,
});

const current = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};
const taskInput = { kind: "object" as const, objectType: SCHEDULED_TASK };

type ProjectionFields = Pick<Exclude<ProductProjection, { componentId: "@ontomato/sdk:MetricChart" }>, "id" | "name" | "componentId" | "inputs" | "outputs" | "config" | "data">;
const projection = (fields: ProjectionFields): ProductProjection => ({ ...current, description: fields.name, ...fields });

const trialProjections: ProjectionFields[] = [
  {
    id: "projection-schedules-summary",
    name: "Task summary",
    componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { task: taskInput },
    outputs: {},
    config: { fields: ["application", "settings", "state", "nextRun"] },
    data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
  },
  {
    id: "projection-schedules-tasks",
    name: "Scheduled tasks",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: { value: taskInput },
    outputs: { selected: taskInput },
    config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
  },
  {
    id: "projection-schedules-form",
    name: "Task form",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: taskInput, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  },
  {
    id: "projection-schedules-run",
    name: "Run now",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: taskInput },
    outputs: {},
    config: {},
    data: { operation: { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} } },
  },
];

/** The trial's projections as Node returns their current records, by ID (`definitions.mjs`). */
export const projections: Record<string, ProductProjection> = Object.fromEntries(
  trialProjections.map((fields) => [fields.id, projection(fields)]),
);

const selectedTask = { selectedTask: { type: { kind: "object" as const, objectType: SCHEDULED_TASK }, deepLink: true } };
const slot = (projectionId: string, input: string) => ({ target: { projectionId }, inputs: { [input]: { state: "selectedTask" } } });

/**
 * The scheduled tasks panel as it was written with code: HTML that places its four projections for the SDK in a frame.
 * The trial's own P is a direct panel now, drawn without a frame; these tests run the frame path that every panel with
 * a module still takes, so they keep the frame's markup here.
 */
export const framedTasksPanelHtml = `<style>
  [v-cloak] { display: none; }
  .panel { display: grid; gap: 12px; grid-template-columns: 260px 1fr; padding: 12px; }
  .side, .main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
</style>
<div id="app" class="panel" v-cloak>
  <aside class="side">
    <el-card shadow="never">
      <template #header>Scheduled tasks</template>
      <projection slot="tasks"></projection>
    </el-card>
  </aside>
  <section class="main">
    <el-card shadow="never">
      <template #header>Selected task</template>
      <projection slot="summary"></projection>
    </el-card>
    <el-card shadow="never">
      <template #header>Task</template>
      <projection slot="form"></projection>
      <projection slot="run"></projection>
    </el-card>
  </section>
</div>
`;

/** The framed scheduled tasks panel's declaration: the list, the summary, the form and the run button. */
export const manifestP = definePanel({
  state: selectedTask,
  members: {
    tasks: {
      ...slot("projection-schedules-tasks", "value"),
      outputs: { selected: { state: "selectedTask" } },
    },
    summary: slot("projection-schedules-summary", "task"),
    form: slot("projection-schedules-form", "task"),
    run: slot("projection-schedules-run", "task"),
  },
  events: {},
});

/** Panel Q's declaration (`q/declaration.mjs`): the summary and nothing of P. */
export const manifestQ = definePanel({
  state: selectedTask,
  members: { summary: slot("projection-schedules-summary", "task") },
  events: {},
});

/** The old workspace sample version used by tests that still exercise that input. */
export const SDK_VERSION = `1.1.1-dev.${"0123456789abcdef".repeat(4)}`;

/** What Node answers for the SDK currently served to panels. */
export const currentSdk = () => Response.json(appsSdkCurrentSchema.parse({
  version: "1.2.0", digest: "a".repeat(64), publicBasePath: "", sdkBasePath: "/apps-sdk/1.2.0",
  manifestPath: "/apps-sdk/1.2.0/sdk.json", componentsPath: "/apps-sdk/1.2.0/components.json",
  checkPath: "/apps-sdk/1.2.0/node/panel-check.mjs",
  docsPath: "/apps-sdk/1.2.0/docs/index.md", referencePath: "/apps-sdk/1.2.0/docs/reference.md",
}));

/** A panel's current record; its HTML has the element the SDK mounts into, and the test supplies the component. */
export function panelRecord(id: string, name: string, manifest: PanelManifest): ProductPanel {
  return { ...current, id, name, description: name, content: { html: '<div id="app"></div>', module: "" }, manifest };
}

/** A use relation of one of the trial's applications, as Java declares it. */
export function panelUse(id: string, pageKey: string, panelId: string, path: string): ApplicationPanelUse {
  return {
    id,
    pageKey,
    panelId,
    path,
    access: { kind: "domain-member" },
  };
}

/** What a panel application's host shows for one use relation: the relation and the panel's current record. */
/** What a frame registered outside any page does with a change its operations report: no page hears of it. */
export const ignoreChanges = () => {};

export const registered = (applicationId: string, use: ApplicationPanelUse, panel: ProductPanel) =>
  ({ kind: "registered", applicationId, use, panel }) as const;

/** The page skill member Node names for a panel read for one page, by a name derived from the panel alone. */
export const memberKeyOf = (panelId: string) => `pvt-${[...panelId].map(char => char.charCodeAt(0).toString(16)).join("").slice(0, 48).padEnd(48, "0")}`;

/**
 * The page skill context Node answers for a panel read or a snapshot read made for one page: which member a message
 * beside that page reaches. A read that names no page gets none.
 */
export function pageSkillContextFor(panel: Pick<ProductPanel, "id">, request: Sent) {
  const query = new URLSearchParams(request.search);
  const applicationId = query.get("applicationId");
  if (!applicationId) return undefined;
  const pageKey = query.get("pageKey")!;
  const permissionCode = query.get("permissionCode");
  const locator = permissionCode ? { permissionCode, pageKey } : { access: "domain-member", pageKey };
  return {
    mode: "member", locator,
    member: { source: { kind: "application-use", applicationId, useId: query.get("useId")! }, memberKey: memberKeyOf(panel.id) },
  };
}

/** Node's answer for a panel read: the panel, and the page skill context when the read names the page it is shown for. */
export function panelAnswer(panel: ProductPanel, request: Sent) {
  const pageSkillContext = pageSkillContextFor(panel, request);
  return Response.json({ panel, ...(pageSkillContext ? { pageSkillContext } : {}) });
}

/** One request that reached the network, as the platform sent it for the frame. */
export interface Sent {
  method: string;
  path: string;
  search: string;
  credential: string | null;
  /** The execution context the request is marked with (`X-Ontomato-Execution-Context`), or null for a live request. */
  execution: string | null;
  body: unknown;
}

/**
 * Installs the platform as the shell starts it — the reader's identity, the app host and the message bridge — with the
 * network answering through `answer`. Returns what was sent, in order.
 */
export function installPlatform(answer: (request: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  installAuthHost({
    getToken: () => READER,
    getApiKey: () => null,
    getUserInfo: () => null,
    responseStatusError: () => null,
    verifySessionOnce: async () => "valid",
    handleAuthExpired: () => {},
  });
  installWorkbenchI18n({
    supported: ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled: false,
    save: null,
    messages: { en: publicEn },
    elementLocale: () => elementEn,
  });
  installAppHost({
    credential: { type: "token", token: READER },
    preferences: { locale: ref("en"), theme: ref("light") } as PlatformPreferences,
    router: createRouter({ history: createMemoryHistory(), routes: [] }),
    onAuthFailure: vi.fn(),
  });
  installProductEmbedding(createApp({}));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input), window.location.href);
    const request: Sent = {
      method: init?.method ?? "GET",
      path: url.pathname,
      search: url.search,
      credential: new Headers(init?.headers).get("tk"),
      execution: new Headers(init?.headers).get(BUILD_TEST_HEADER),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body instanceof FormData ? init.body : null),
    };
    sent.push(request);
    return answer(request);
  });
  return sent;
}

/** The answer a test gives for anything it did not expect. */
export const nothingAt = (request: Sent) =>
  Response.json({ error: { message: `Nothing at ${request.method} ${request.path}` } }, { status: 404 });

/** The frame as the panel host draws it: sandboxed with scripts only, in the platform's document. */
export function panelFrame() {
  const element = document.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts");
  document.body.append(element);
  return element.contentWindow!;
}

const ownParent = Object.getOwnPropertyDescriptor(window, "parent");

/**
 * Runs what follows as code inside `frame`: its `window.parent` is the platform's window as a sandboxed frame without
 * `allow-same-origin` sees it. It can post a message there and read nothing else; the post arrives a task later on the
 * platform's window, with the frame as its source and `null` as its origin, as a browser delivers it.
 */
export function inside(frame: Window) {
  const parent = new Proxy(
    {},
    {
      get(_target, property) {
        if (property !== "postMessage")
          throw new DOMException('Blocked a frame with origin "null" from accessing a cross-origin frame.', "SecurityError");
        return (data: unknown, _origin: string, transfer: MessagePort[] = []) => {
          const cloned = structuredClone(data);
          setTimeout(() =>
            window.dispatchEvent(new MessageEvent("message", { data: cloned, origin: "null", source: frame, ports: transfer })),
          );
        };
      },
    },
  );
  // The fixture runs the frame SDK in this window; deliver the host's messages to it as a browser would.
  frame.postMessage = (data: unknown) => {
    const cloned = structuredClone(data);
    setTimeout(() => window.dispatchEvent(new MessageEvent("message", { data: cloned, source: parent as Window })));
  };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
}

/** Writes the frame's document as the panel host does for a registered use: the panel's renderable definition and the run's facts. */
export function writePanelDocument(source: ReturnType<typeof registered>, url: string, state: PanelHostMessage["state"]) {
  const { applicationId, use, panel: { content, manifest, name } } = source;
  writeFrameDocument({
    kind: "panel-host-message", panel: { content, manifest }, pageKey: use.pageKey, use: { applicationId, useId: use.id }, url, label: name, state,
  });
}

/** Writes the frame's document from the run's facts the platform's panel host wrote for it. */
export function writeFrameDocument(message: PanelHostMessage) {
  // Happy DOM drops the # prefix when it serializes a slot attribute back to Vue's runtime template.
  document.body.insertAdjacentHTML("beforeend", message.panel.content.html.replace(/(<template\s+)#(?=[\w-])/g, "$1v-slot:"));
  const facts = document.createElement("script");
  facts.type = "application/json";
  facts.setAttribute("data-panel-host-message", "");
  facts.textContent = JSON.stringify(message);
  document.body.append(facts);
}

/** The run's facts in a frame document the platform's panel host wrote (`panelFrameDocument`). */
export function hostMessageOf(frameDocument: string): PanelHostMessage {
  const facts = /<script type="application\/json" data-panel-host-message>\n([\s\S]*?)\n<\/script>/.exec(frameDocument);
  if (!facts) throw new Error("The frame document carries no host message");
  return JSON.parse(facts[1]!) as PanelHostMessage;
}

/**
 * Mounts a page of the platform as the shell does — its router, its language and Element Plus — into the platform's
 * document, and gives back the element it is drawn in and the app.
 */
export function mountPlatformPage(render: () => ReturnType<typeof h>, router: Router) {
  const app = createApp({ render }).use(router).use(workbenchI18n()).use(ElementPlus);
  const element = document.createElement("div");
  document.body.append(element);
  app.mount(element);
  return { app, element };
}

/** The frame the platform's panel host drew, once it has its document. */
export async function panelHostFrame() {
  return vi.waitFor(
    () => {
      const found = document.querySelector<HTMLIFrameElement>("iframe.panel-host-frame");
      if (!found?.getAttribute("srcdoc")) throw new Error("The panel host has drawn no frame yet");
      return found;
    },
    { timeout: 5000 },
  );
}

/** A panel component that places the given slots' projections, as a panel's HTML does with `<projection slot>`. */
export function panelOf(...slots: string[]) {
  return defineComponent({
    render: () => h("div", slots.map((name) => h(resolveComponent("Projection"), { slot: name }))),
  });
}

/** Puts the platform's window back as it was, after the frame's page went away. */
export function leaveFrame() {
  // The frame's context and bridge close their ports when its page goes away.
  window.dispatchEvent(new Event("pagehide"));
  if (ownParent) Object.defineProperty(window, "parent", ownParent);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
}

/** Node's snapshot of a panel's revisions, with the page skill context when the read names the page it is shown for. */
export function panelSnapshot(panel: ProductPanel, current: Record<string, { revision: number }> = projections, request?: Sent) {
  const revisions = new Map<string, number>();
  const members: PanelMemberSnapshot[] = [];
  for (const [member, { target }] of Object.entries(panel.manifest.members)) {
    if ("projectionId" in target) {
      const id = target.projectionId;
      const revision = current[id]!.revision;
      revisions.set(id, revision);
      members.push({ status: "ready", memberPath: [{ member }], target: { kind: "projection", id }, revision });
    }
  }
  const pageSkillContext = request && pageSkillContextFor(panel, request);
  return Response.json({
    panel: { id: panel.id, revision: panel.revision },
    projections: [...revisions].map(([id, revision]) => ({ id, revision })),
    members,
    ...(pageSkillContext ? { pageSkillContext } : {}),
  });
}

/**
 * Panel application A with a panel that is the task's form alone, and a draft an agent wrote for that page: the page's
 * address with the draft's link, and what the platform answers for the page, the panel and the frame. The draft is the
 * form's own save unless `operation` names another.
 */
export function draftScenario(operation = `${SCHEDULED_TASK}.save`) {
  const formProjection = projections["projection-schedules-form"]!;
  const panel = panelRecord(
    "panel-schedules-form",
    "Task form (trial)",
    definePanel({ state: selectedTask, members: { form: slot(formProjection.id, "task") }, events: {} }),
  );
  const use = panelUse("use-trial-a-form", "panels-trial-a-form", panel.id, "/applications/app-panels-trial-a/form");
  // The operations application's form for the task, with a second case set to choose from.
  const form = platformScheduleFormSchema.parse({
    ...taskForm,
    fields: taskForm.fields.map((field) =>
      field.key === "caseSetId" && field.type === "select"
        ? { ...field, options: [...field.options, { value: "set-smoke", label: "Smoke (8)", description: null, disabled: false, disabledReason: null }] }
        : field,
    ),
  });
  // What the agent wrote: the task's own form, with the other case set.
  const draft = { pageKey: use.pageKey, operation, target: { id: task.id }, form: { ...task.content, caseSetId: "set-smoke" } };
  const link = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/task.page-draft.json" });
  const address = `/applications/app-panels-trial-a/form?${link}`;
  // The form's projection is answered only after the draft: the draft reaches the panel before the form that takes it
  // exists, which is the order the SDK has to hold the draft for.
  let draftServed!: () => void;
  const served = new Promise<void>((resolve) => (draftServed = resolve));
  const answer = (request: Sent) => {
    if (request.path === "/api/data-query/platform/applications/app-panels-trial-a/panel-uses")
      return Response.json({
        success: true,
        data: { applicationId: "app-panels-trial-a", entry: { path: "/panels-trial-a", renderer: "panels" }, panelUses: [use] },
      });
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === "/api/apps-sdk/current") return currentSdk();
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
    if (request.path === `/api/product-projections/${formProjection.id}`)
      return served.then(() => Response.json({ projection: formProjection }));
    if (request.path === `/api/data-query/platform/scheduled-tasks/${task.id}`) return Response.json(task);
    // The owner answers its form for the values it is given, as it checks a draft against them.
    if (request.path === `/api/data-query/platform/scheduled-tasks/applications/${task.appId}/form`)
      return Response.json({ ...form, values: (request.body as { values: typeof form.values }).values });
    if (request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft") {
      draftServed();
      return Response.json(draft);
    }
    return nothingAt(request);
  };
  return { panel, use, address, answer };
}

/** The coordinator of an instance a test builds by hand and runs no operation of: any call to it fails the test. */
const unused = () => Promise.reject(new Error("This test runs no operation of the panel"));
export const noOperations: { operations: PanelHumanOperations; confirmOperation: ConfirmPanelOperation } = {
  operations: { describe: unused, read: unused, prepare: unused }, confirmOperation: unused,
};

/** The form save calls that reached the coordinator. */
export function formSaveCalls(sent: readonly Sent[]) {
  return sent.filter((request) => request.method === "POST" && request.path === "/api/panel-operations/intents")
    .map(({ body }) => (body as { call: { target: PanelOperationCall["target"]; input: PanelFormSaveInput } }).call);
}

/**
 * Node's coordinator for a person's writes, as the frame and its host reach it: the frame prepares one intent, the host
 * reads it back and dispatches it once, and `outcome` is what the owner's registered operation returned for it. Nothing
 * here needs confirming; the host's dialog is the host's own test.
 */
export function humanIntents(outcome: (operationId: string, call: PanelOperationCall) => unknown, target: { source: "input"; input: string } = { source: "input", input: "task" }) {
  const prepared = new Map<string, { preparation: PanelHumanOperationPreparation; call: PanelOperationCall }>();
  return (request: Sent): Response | undefined => {
    // The owner's write: one object it acts on, with nothing to confirm.
    if (request.method === "GET" && request.path === "/api/panel-operations/descriptor")
      return Response.json({ handlerRef: "owner.write", label: "Write", effect: "write", target, inputSchema: {}, resultSchema: {}, batch: false });
    if (request.method === "POST" && request.path === "/api/panel-operations/intents") {
      const { operationId, call } = request.body as { operationId: string; call: PanelOperationCall };
      const preparation = { intentId: randomId(), operationId, label: operationId, confirmation: { kind: "none" as const } };
      prepared.set(preparation.intentId, { preparation, call });
      return Response.json(preparation);
    }
    const read = /^\/api\/panel-operation-intents\/([^/?]+)$/.exec(request.path);
    if (read && request.method === "GET") return Response.json(prepared.get(read[1]!)?.preparation);
    const dispatch = /^\/api\/panel-operations\/intents\/([^/]+)\/dispatch$/.exec(request.path);
    if (dispatch && request.method === "POST") {
      const { preparation: { intentId, operationId }, call } = prepared.get(dispatch[1]!)!;
      return Response.json({ kind: "dispatched", intentId, outcome: outcome(operationId, call) });
    }
    return undefined;
  };
}
