import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { buildExecutionContext, type BuildTestContext } from "@ontomato/contracts/build-tests";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import type { ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import {
  currentSdk, hostMessageOf, inside, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelHostFrame, projections,
  READER, SDK_VERSION, writeFrameDocument, type Sent,
} from "./panel-frame";

/*
 * An author previews the panel candidate in their workspace (design 6.2, 9.3 G1) through the platform's own route, panel
 * host, app host and message bridge, with the SDK's own modules in the frame. Only the network is a recorded stand-in,
 * answering as Node's candidate port and the owners would.
 *
 * What this rules out: a preview that reads or writes formal registrations to render; a candidate whose workspace or
 * preview context crosses into the frame; a frame of a preview whose requests go out live, or whose request an owner
 * refused is sent again without its mark; an undeclared request reaching the network; a non-author shown a candidate;
 * and a preview that misses the author's changed files.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const AGENT = "3f1b6a2e-8c4d-4e5f-9a0b-1c2d3e4f5a6b";
const agentForm: ProductProjection = {
  id: "projection-agent-definition-form",
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 3,
  createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z",
  editable: false,
  visibility: "domain",
  name: "Agent definition",
  description: "Agent definition",
  componentId: "ObjectForm",
  binding: { kind: "PlatformObjectType", id: "platform:AgentDefinition" },
  inputs: {},
  display: {},
};
const summary = projections["projection-schedules-summary"]!;

const candidateOf = (html: string, test: BuildTestContext | null): CandidatePanelSource => ({
  kind: "candidate",
  workspace: { id: WORKSPACE, ref: "working" },
  panel: {
    content: { html, module: "" },
    manifest: definePanel({
      state: {},
      slots: { definition: { projectionId: agentForm.id, inputs: {} }, summary: { projectionId: summary.id, inputs: {} } },
      operations: [],
    }),
    sdkVersion: SDK_VERSION,
  },
  previewContext: { kind: "build-test", test },
});

const readyTest: BuildTestContext = {
  contextId: "test-context-1", workspaceId: WORKSPACE, status: "READY", expiresAt: 1_900_000_000_000, classNames: [],
  sampleSummary: { name: "test-data/sample.json", classes: 1, sha256: null }, resources: [],
};

const candidatePath = `/api/workspaces/${WORKSPACE}/panel-candidate`;
const previewAddress = `/app-builder/${WORKSPACE}/panel-preview/working/agent-settings`;

/** Node's candidate port and the owners, as they answer a preview. An owner refuses a write marked with a build-test context. */
function network(candidate: () => CandidatePanelSource | Response) {
  const streams: ProductDefinitionTarget[][] = [];
  const answer = (request: Sent) => {
    if (request.path === candidatePath) {
      const source = candidate();
      return source instanceof Response ? source : Response.json(source);
    }
    if (request.path === "/api/apps-sdk/current") return currentSdk();
    if (request.path === "/api/product-assets/definition-stream") {
      streams.push((request.body as { targets: ProductDefinitionTarget[] }).targets);
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    }
    if (request.path === `/api/product-projections/${agentForm.id}`) return Response.json({ projection: agentForm });
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    if (request.path === "/api/data-query/platform/scheduled-tasks") return Response.json({ tasks: [], timeZone: "UTC" });
    if (request.method === "PUT" && request.path === `/api/assistant/agent-definitions/${AGENT}` && request.execution)
      return Response.json({ error: { code: "BUILD_TEST_UNSUPPORTED", message: "This interface does not support test data" } }, { status: 422 });
    return nothingAt(request);
  };
  return { answer, streams };
}

async function openPreview(answer: (request: Sent) => Response) {
  const sent = installPlatform(answer);
  // The platform's own route record, with its page loaded up front: each test starts the frame's modules afresh.
  const routes = appBuilderPages().map(route => route.name === "PanelCandidatePreview" ? { ...route, component: PanelCandidateRoute } as RouteRecordRaw : route);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(previewAddress);
  const page = mountPlatformPage(() => h(RouterView), router);
  return { ...page, router, sent };
}

/** Starts the frame's own SDK modules on the document the host wrote, as the frame's browser would. */
async function startFrame(frame: HTMLIFrameElement) {
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const { contextTransport } = await import("../../../../../packages/apps-sdk/src/context");
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  const { ref } = await import("vue");
  const mounted = await mountPanel({ render: () => h("div") });
  return { ...mounted, ref, transport: contextTransport(mounted.appContext) };
}

function visibility() {
  const current = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  function set(value: "visible" | "hidden") {
    current.mockReturnValue(value);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  return { set, reset: () => { set("visible"); current.mockRestore(); } };
}

/** Anything the preview asked of a formal registration: a use relation, an application, a panel record or its writes. */
const formal = (sent: Sent[]) => sent.filter(request =>
  request.path.startsWith("/api/product-panels") || request.path.includes("/platform/applications") || request.method === "PUT" && request.path.startsWith("/api/product-"));

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("previews the author's candidate through the same panel host, with only its definition in the frame", async () => {
  const { answer, streams } = network(() => candidateOf('<div id="app"></div>', null));
  const { app, sent } = await openPreview(answer);
  try {
    const frame = await panelHostFrame();
    expect(sent[0]).toMatchObject({ method: "GET", path: candidatePath, search: "?ref=working", credential: READER, execution: null });
    const message = hostMessageOf(frame.srcdoc);
    // Only the renderable definition crosses into the frame: no workspace, ref or preview context.
    expect(message.panel).toEqual(candidateOf('<div id="app"></div>', null).panel);
    expect(message).toMatchObject({ pageKey: "agent-settings", url: previewAddress, label: "Panel preview (working)" });
    // The frame runs the exact SDK version the candidate names, not the one the platform currently serves.
    expect(frame.srcdoc).toContain(`"@ontomato/sdk/panel":"/apps-sdk/${SDK_VERSION}/panel.js"`);
    // The preview is an author's host: the registered projections the candidate names follow the definition stream,
    // and no panel is registered for it to follow.
    await vi.waitFor(() => expect(streams).toEqual([[
      { kind: "projection", id: agentForm.id }, { kind: "projection", id: summary.id },
    ]]));
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it.each([
  { case: "has none", test: null },
  { case: "has one", test: readyTest },
])("runs the frame on the workspace's build-test context when the workspace $case, never live", async ({ test }) => {
  const { answer } = network(() => candidateOf('<div id="app"></div>', test));
  const { app, sent } = await openPreview(answer);
  try {
    const frame = await panelHostFrame();
    const { appContext, transport } = await startFrame(frame);
    expect(appContext.executionContext).toEqual(buildExecutionContext(WORKSPACE, test));
    const before = sent.length;
    const marked = JSON.stringify({ kind: "build-test", contextId: test?.contextId ?? null });

    // The registered projections and a Java read their bindings declare go out marked with the preview's context.
    expect((await transport.request(`/product-projections/${agentForm.id}`, {}, "")).status).toBe(200);
    expect((await transport.request(`/product-projections/${summary.id}`, {}, "")).status).toBe(200);
    expect((await transport.request("/platform/scheduled-tasks", {}, "/data-query")).status).toBe(200);
    // A management write the binding declares reaches its owner marked, and the owner's refusal is the answer: it is
    // not sent again without the mark.
    await expect(transport.request(`/assistant/agent-definitions/${AGENT}`, { method: "PUT", body: "{}" }, ""))
      .rejects.toMatchObject({ code: "BUILD_TEST_UNSUPPORTED" });
    // What no projection of the candidate declares never leaves the frame, a formal registration's write included.
    for (const [path, init, service] of [
      ["/product-panels/agent-settings", { method: "PUT", body: "{}" }, ""],
      ["/product-projections/projection-schedules-form", {}, ""],
      [`/assistant/agent-definitions/${AGENT}`, { method: "DELETE" }, ""],
      ["/dsl/executeV1", { method: "POST", body: "{}" }, "/data-query"],
    ] as const)
      await expect(transport.request(path, init, service)).rejects.toThrow("Outside what this panel's projections declare");

    const fromFrame = sent.slice(before);
    expect(fromFrame.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /api/product-projections/${agentForm.id}`,
      `GET /api/product-projections/${summary.id}`,
      "GET /api/data-query/platform/scheduled-tasks",
      `PUT /api/assistant/agent-definitions/${AGENT}`,
    ]);
    expect(fromFrame.every(request => request.execution === marked && request.credential === READER)).toBe(true);
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("embeds no live product in a candidate's frame", async () => {
  const { answer } = network(() => candidateOf('<div id="app"></div>', null));
  const { app, sent } = await openPreview(answer);
  try {
    const { appContext } = await startFrame(await panelHostFrame());
    const before = sent.length;
    const element = document.createElement("div");
    document.body.append(element);
    appContext.mountProductAsset(element, "asset-1");
    await vi.waitFor(() => expect(element.textContent).toBe("Product embedding is unavailable in build-test previews"));
    expect(sent.slice(before)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("refuses a reader who is not the workspace's author, and shows the refusal", async () => {
  const { answer, streams } = network(() => Response.json({ error: { message: "Workspace not found" } }, { status: 404 }));
  const { app, element, sent } = await openPreview(answer);
  try {
    await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent).toBe("Workspace not found"));
    expect(element.querySelector("iframe")).toBeNull();
    expect(streams).toEqual([]);
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("reads the candidate again when the author comes back, and waits for an unsaved form", async () => {
  const foreground = visibility();
  let html = '<div id="app"></div>';
  const { answer } = network(() => candidateOf(html, null));
  const { app, sent } = await openPreview(answer);
  const reads = () => sent.filter(request => request.path === candidatePath);
  try {
    const frame = await panelHostFrame();
    const { context, ref } = await startFrame(frame);
    const shown = frame.srcdoc;

    // Unchanged files keep the frame as it is.
    foreground.set("hidden");
    foreground.set("visible");
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    expect(frame.srcdoc).toBe(shown);

    // The author changed the files while the reader holds an unsaved form: the new candidate waits for it.
    html = '<div id="app"></div><p id="changed"></p>';
    const said = new Promise<void>(resolve => window.addEventListener("message", event => {
      if (event.data?.kind === "dirty" && event.data.dirty) resolve();
    }));
    const unsaved = ref(true);
    context.holdUnsaved(unsaved);
    // The frame's word reaches the host a task later, as a browser delivers a message.
    await said;
    foreground.set("hidden");
    foreground.set("visible");
    await vi.waitFor(() => expect(reads()).toHaveLength(3));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(frame.srcdoc).toBe(shown);
    unsaved.value = false;
    await vi.waitFor(() => expect(hostMessageOf(frame.srcdoc).panel.content.html).toContain('id="changed"'));
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
    foreground.reset();
  }
});
