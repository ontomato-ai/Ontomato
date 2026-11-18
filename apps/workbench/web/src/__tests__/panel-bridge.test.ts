import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, defineComponent, h, ref, resolveComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelHostMessage } from "@ontomato/contracts/panel-host";
import { platformTaskSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installAppHost, installProductEmbedding } from "../../../../../packages/platform-web/src/app-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { connectAppContext, contextTransport } from "../../../../../packages/apps-sdk/src/context";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";

/*
 * A panel's frame and the platform, joined by the real message bridge at both ends (overall design 3.4, 5.1): the
 * platform's own app host and bridge as the shell installs them, the frame registered by the platform's own panel host,
 * and on the frame's side the SDK's own `mountPanel` and `connectAppContext`. Only the browser is stood in for: the
 * frame sees the platform's window the way a sandboxed frame without `allow-same-origin` does, and the network is a
 * recorded `fetch`.
 *
 * What this rules out: a panel frame the bridge does not answer (the frame was registered without its application); a
 * panel whose reads never reach the platform, or reach it as anything but the reader; a frame nobody registered getting
 * a port; and a port that keeps answering for one application once its frame is another's.
 */

const READER = "reader-token";
const SCHEDULED_TASK = "platform:ScheduledTask";

/** The reader's scheduled task, the contract's own operations-diagnosis example. */
const HERE = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(HERE, "..", "..", "..", "..", "..", "packages", "contracts", "examples", "platform-schedules.json"), "utf8"),
) as { creates: { name: string; response: unknown }[] };
const task: PlatformTask = platformTaskSchema.parse(
  examples.creates.find((example) => example.name === "operations-autotest")!.response,
);

/** X, the trial's shared summary projection, as Node returns its current record. */
const summary: ProductProjection = {
  id: "projection-schedules-summary",
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
  editable: false,
  name: "Task summary",
  description: "One scheduled task as a reader recognises it.",
  visibility: "domain",
  componentId: "ObjectSummary",
  binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
  display: { fields: ["application", "settings", "state", "nextRun"] },
};

/** Q, the trial's small panel: X and nothing else, for the task its address names. */
const panelQ: ProductPanel = {
  id: "panel-schedules-summary",
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
  editable: false,
  name: "Task summary (trial)",
  description: "One scheduled task as a reader recognises it, for the task its address names.",
  visibility: "domain",
  content: { html: '<div id="app"></div>', module: "" },
  manifest: definePanel({
    state: { selectedTask: { kind: "object", objectType: SCHEDULED_TASK, deepLink: true } },
    slots: { summary: { projectionId: summary.id, inputs: { task: { state: "selectedTask" } } } },
    operations: [],
  }),
};

/** B's use of Q, as Java declares it. */
const useOfQ: ApplicationPanelUse = {
  id: "use-trial-b-summary",
  pageKey: "panels-trial-b-summary",
  panelId: panelQ.id,
  path: "/summary",
  access: { kind: "domain-member" },
  skill: { namespace: { kind: "provider", provider: "workbench" }, name: "panels" },
};

/** What reached the network: the platform's request for each one the frame made over the bridge. */
interface Sent {
  method: string;
  path: string;
  credential: string | null;
}
let sent: Sent[] = [];

function answer(path: string) {
  if (path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
  if (path === `/api/data-query/platform/scheduled-tasks/${task.id}`) return Response.json(task);
  return Response.json({ error: { message: `Nothing at ${path}` } }, { status: 404 });
}

/** The frame as the panel host draws it: sandboxed with scripts only, in the platform's document. */
function panelFrame() {
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
function inside(frame: Window) {
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

/** What a connect came to within a while: the frame's context, or nothing at all. */
async function connectWithin(milliseconds: number) {
  return Promise.race([
    connectAppContext().then(
      () => "connected",
      (reason: unknown) => `failed: ${(reason as Error).message}`,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("no answer"), milliseconds)),
  ]);
}

beforeEach(() => {
  sent = [];
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
  // The shell's own bridge, as the platform starts it.
  installProductEmbedding(createApp({}));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    sent.push({ method: init?.method ?? "GET", path: url.pathname, credential: headers.get("tk") });
    return answer(url.pathname);
  });
});

afterEach(() => {
  // The frame's context and bridge close their ports when its page goes away.
  window.dispatchEvent(new Event("pagehide"));
  if (ownParent) Object.defineProperty(window, "parent", ownParent);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("a panel frame and the platform's message bridge", () => {
  it("connects as its application's frame, and reads its projection and its task as the reader", { timeout: 15000 }, async () => {
    const frame = panelFrame();
    // B's page shows Q: B's panel host registers the frame it draws.
    platformPanelHost("app-panels-trial-b").frame(frame, useOfQ);

    // The frame's document, as the panel host writes it: the panel's HTML and the run's facts, Q opened at one task.
    const message: PanelHostMessage = {
      kind: "panel-host-message",
      panel: panelQ,
      pageKey: useOfQ.pageKey,
      url: "/applications/app-panels-trial-b/summary",
      label: panelQ.name,
      state: { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } },
    };
    document.body.insertAdjacentHTML("beforeend", panelQ.content.html);
    const facts = document.createElement("script");
    facts.type = "application/json";
    facts.setAttribute("data-panel-host-message", "");
    facts.textContent = JSON.stringify(message);
    document.body.append(facts);

    inside(frame);
    const Panel = defineComponent({ render: () => h(resolveComponent("Projection"), { slot: "summary" }) });
    const { appContext } = await mountPanel(Panel);

    // The handshake: the frame came up with the platform's own snapshot, as a live frame.
    expect(appContext.executionContext).toEqual({ kind: "live" });
    expect(appContext.locale.value).toBe("en");
    // The SDK drew X from its current record and the task the address named, both read through the platform.
    await vi.waitFor(
      () => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title),
      { timeout: 5000 },
    );
    expect(sent).toEqual([
      { method: "GET", path: `/api/product-projections/${summary.id}`, credential: READER },
      { method: "GET", path: `/api/data-query/platform/scheduled-tasks/${task.id}`, credential: READER },
    ]);

    // What a panel frame may ask for is the platform's whitelist, nothing more: not a panel record, not a DSL query.
    const transport = contextTransport(appContext);
    await expect(transport.request(`/product-panels/${panelQ.id}`, {}, "")).rejects.toThrow("declared SDK product operation");
    await expect(transport.request("/dsl/executeV1", { method: "POST", body: "{}" }, "/data-query")).rejects.toThrow(
      "declared SDK capability",
    );
    expect(sent).toHaveLength(2);
  });

  it("gives no port to a frame no panel host registered, and one once a panel host does", { timeout: 15000 }, async () => {
    const frame = panelFrame();
    inside(frame);

    expect(await connectWithin(500)).toBe("no answer");
    expect(sent).toEqual([]);

    // The same frame, once A's panel host has drawn it.
    platformPanelHost("app-panels-trial-a").frame(frame, { ...useOfQ, id: "use-trial-a-tasks", pageKey: "panels-trial-a-tasks" });
    expect(await connectWithin(5000)).toBe("connected");
  });

  it("stops answering for one application once the frame is another's", { timeout: 15000 }, async () => {
    const frame = panelFrame();
    platformPanelHost("app-panels-trial-a").frame(frame, { ...useOfQ, id: "use-trial-a-tasks", pageKey: "panels-trial-a-tasks" });
    inside(frame);
    const asA = contextTransport(await connectAppContext());
    expect(await (await asA.request(`/product-projections/${summary.id}`, {}, "")).json()).toEqual({ projection: summary });

    // The frame is now B's: the port A's page was given refuses, and nothing more goes out for it.
    platformPanelHost("app-panels-trial-b").frame(frame, useOfQ);
    await expect(asA.request(`/product-projections/${summary.id}`, {}, "")).rejects.toThrow("no longer registered");
    expect(sent).toHaveLength(1);

    // As B's frame it connects again, and is answered.
    const asB = contextTransport(await connectAppContext());
    expect((await asB.request(`/product-projections/${summary.id}`, {}, "")).ok).toBe(true);
    expect(sent.map((request) => request.credential)).toEqual([READER, READER]);
  });
});
