import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, defineComponent, h, ref, resolveComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { definePanel, type PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelHostMessage } from "@ontomato/contracts/panel-host";
import {
  platformScheduleFormSchema,
  platformTaskSchema,
  type PlatformScheduleForm,
  type PlatformTask,
} from "@ontomato/contracts/platform-schedules";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
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
) as Record<"creates" | "forms", { name: string; response: Record<string, unknown> }[]>;
const example = (list: "creates" | "forms", name: string) => examples[list].find((entry) => entry.name === name)!.response;

/** The reader's scheduled task: the contract's own operations-diagnosis example, as the trial's test task is. */
export const task: PlatformTask = platformTaskSchema.parse(example("creates", "operations-autotest"));

/** The task's application's form for what the task holds, as the operations application answers it. */
export const taskForm: PlatformScheduleForm = platformScheduleFormSchema.parse({
  ...example("forms", "operations-switch-back-to-autotest"),
  values: task.content,
  submittable: true,
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
    skill: { namespace: { kind: "provider", provider: "workbench" }, name: "panels" },
  };
}

/** One request that reached the network, as the platform sent it for the frame. */
export interface Sent {
  method: string;
  path: string;
  search: string;
  credential: string | null;
  body: unknown;
}

/**
 * Installs the platform as the shell starts it — the reader's identity, the app host and the message bridge — with the
 * network answering through `answer`. Returns what was sent, in order.
 */
export function installPlatform(answer: (request: Sent) => Response) {
  const sent: Sent[] = [];
  installAuthHost({
    getToken: () => READER,
    getApiKey: () => null,
    getUserInfo: () => null,
    responseStatusError: () => null,
    verifySessionOnce: async () => "valid",
    handleAuthExpired: () => {},
  });
  installAppHost({
    credential: { type: "token", token: READER },
    preferences: { locale: ref("en"), theme: ref("light") } as PlatformPreferences,
    router: createRouter({ history: createMemoryHistory(), routes: [] }),
    onAuthFailure: vi.fn(),
  });
  installProductEmbedding(createApp({}));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const request: Sent = {
      method: init?.method ?? "GET",
      path: url.pathname,
      search: url.search,
      credential: new Headers(init?.headers).get("tk"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
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
        return (data: unknown, _origin: string, transfer: MessagePort[] = []) =>
          setTimeout(() =>
            window.dispatchEvent(new MessageEvent("message", { data, origin: "null", source: frame, ports: transfer })),
          );
      },
    },
  );
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
}

/** Writes the frame's document as the panel host does: the panel's HTML and the run's facts. */
export function writePanelDocument(panel: ProductPanel, use: ApplicationPanelUse, url: string, state: PanelHostMessage["state"]) {
  const message: PanelHostMessage = { kind: "panel-host-message", panel, pageKey: use.pageKey, url, label: panel.name, state };
  document.body.insertAdjacentHTML("beforeend", panel.content.html);
  const facts = document.createElement("script");
  facts.type = "application/json";
  facts.setAttribute("data-panel-host-message", "");
  facts.textContent = JSON.stringify(message);
  document.body.append(facts);
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
