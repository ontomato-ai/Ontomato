import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, defineComponent, h, ref, resolveComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { definePanel, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelHostMessage } from "@ontomato/contracts/panel-host";
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

type ProjectionFields = Pick<ProductProjection, "id" | "name" | "componentId" | "binding" | "inputs" | "display">;
const projection = (fields: ProjectionFields): ProductProjection => ({ ...current, description: fields.name, ...fields });

const trialProjections: ProjectionFields[] = [
  {
    id: "projection-schedules-summary",
    name: "Task summary",
    componentId: "ObjectSummary",
    binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
    inputs: { task: taskInput },
    display: { fields: ["application", "settings", "state", "nextRun"] },
  },
  {
    id: "projection-schedules-tasks",
    name: "Scheduled tasks",
    componentId: "ObjectList",
    binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
    inputs: { value: taskInput },
    display: {},
  },
  {
    id: "projection-schedules-form",
    name: "Task form",
    componentId: "ObjectForm",
    binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
    inputs: { task: taskInput },
    display: {},
  },
  {
    id: "projection-schedules-run",
    name: "Run now",
    componentId: "OperationButton",
    binding: { kind: "PlatformOperation", id: "schedules.runNow" },
    inputs: { task: taskInput },
    display: {},
  },
];

/** The trial's projections as Node returns their current records, by ID (`definitions.mjs`). */
export const projections: Record<string, ProductProjection> = Object.fromEntries(
  trialProjections.map((fields) => [fields.id, projection(fields)]),
);

const selectedTask = { selectedTask: { kind: "object" as const, objectType: SCHEDULED_TASK, deepLink: true } };
const slot = (projectionId: string, input: string) => ({ projectionId, inputs: { [input]: { state: "selectedTask" } } });

/** Panel P's declaration (`p/declaration.mjs`): the list, the summary, the form and the run button. */
export const manifestP = definePanel({
  state: selectedTask,
  slots: {
    tasks: slot("projection-schedules-tasks", "value"),
    summary: slot("projection-schedules-summary", "task"),
    form: slot("projection-schedules-form", "task"),
    run: slot("projection-schedules-run", "task"),
  },
  operations: [],
});

/** Panel Q's declaration (`q/declaration.mjs`): the summary and nothing of P. */
export const manifestQ = definePanel({
  state: selectedTask,
  slots: { summary: slot("projection-schedules-summary", "task") },
  operations: [],
});

/**
 * The exact SDK version the trial's panel records name: an installed development build, with its content hash. It is not
 * the version the platform currently serves, so a frame that loads it shows the host followed the record.
 */
export const SDK_VERSION = `1.1.1-dev.${"0123456789abcdef".repeat(4)}`;

/** What Node answers for the SDK it currently serves; a panel's frame loads the version its record names instead. */
export const currentSdk = () => Response.json({
  version: "1.2.0", publicBasePath: "", sdkBasePath: "/apps-sdk/1.2.0",
  manifestPath: "/apps-sdk/1.2.0/sdk.json", docsPath: "/apps-sdk/1.2.0/docs/index.md", referencePath: "/apps-sdk/1.2.0/docs/reference.md",
});

/** A panel's current record; its HTML has the element the SDK mounts into, and the test supplies the component. */
export function panelRecord(id: string, name: string, manifest: PanelManifest): ProductPanel {
  return { ...current, id, name, description: name, content: { html: '<div id="app"></div>', module: "" }, manifest, sdkVersion: SDK_VERSION };
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
  const { applicationId, use, panel: { content, manifest, sdkVersion, name } } = source;
  writeFrameDocument({
    kind: "panel-host-message", panel: { content, manifest, sdkVersion }, pageKey: use.pageKey, use: { applicationId, useId: use.id }, url, label: name, state,
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

export function panelSnapshot(panel: ProductPanel, current = projections) {
  const ids = new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId));
  return Response.json({
    panel: { id: panel.id, revision: panel.revision },
    projections: [...ids].map(id => ({ id, revision: current[id]!.revision })),
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
    definePanel({ state: selectedTask, slots: { form: slot(formProjection.id, "task") }, operations: [] }),
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
    if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
    if (request.path === "/api/apps-sdk/current") return currentSdk();
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel);
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
