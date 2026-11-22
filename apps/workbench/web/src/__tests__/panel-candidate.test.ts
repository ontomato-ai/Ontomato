import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import type { ProductDefinitionTarget } from "@ontomato/contracts/product-subscriptions";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import { confirmDiscard,
  installPlatform, leaveFrame, mountPlatformPage, nothingAt, PLACE_EVERY_MEMBER, projections, READER, type Sent,
} from "./panel-frame";

/*
 * An author previews the panel candidate in their workspace (design 6.2, 9.3 G1) through the platform's own route and
 * panel host, its module running in the platform's document like any panel's. Only the network is a stand-in, answering
 * as Node's candidate port and read entry would.
 *
 * What this rules out: a preview that reads or writes formal registrations to render; a candidate whose members read
 * anywhere but Node's read entry, or as anything but the author's workspace; a preview that runs an operation; a
 * non-author shown a candidate; and a preview that misses the author's changed files, or replaces an unsaved form.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
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
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: { values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {},
  config: {},
  data: {
    createForm: { source: { type: { kind: "PlatformObjectType", id: "platform:AgentDefinition" } }, read: "createForm", params: { values: { input: "values" }, changedField: { input: "changedField" } } },
  },
  // The definitions service's own save; with no agent to edit, a new agent's.
  operations: { save: { operation: { kind: "PlatformOperation", id: "platform:AgentDefinition.save" } } },
};
/** The definitions service's save as Node admits it for the form: a create, the form holding no agent. */
const createAgent = {
  kind: "form.save", handlerRef: "platform:AgentDefinition.save", label: "Save", effect: "write",
  target: { source: "draft", slot: "definition" }, inputSchema: {}, resultSchema: {}, batch: false,
};
const summary = projections["projection-schedules-summary"]!;

const candidateOf = (html: string): CandidatePanelSource => ({
  kind: "candidate",
  workspace: { id: WORKSPACE, ref: "working" },
  panel: {
    content: { html, module: PLACE_EVERY_MEMBER },
    manifest: definePanel({
      state: {},
      members: { definition: { target: { projectionId: agentForm.id }, inputs: {} }, summary: { target: { projectionId: summary.id }, inputs: {} } },
      commands: {},
    }),
  },
  previewContext: { kind: "build-test", test: null },
});


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
    if (request.path === "/api/product-panels/definition-stream") {
      streams.push((request.body as { targets: ProductDefinitionTarget[] }).targets);
      return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    }
    if (request.path === `/api/product-projections/${agentForm.id}`) return Response.json({ projection: agentForm });
    if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
    // Node answers what a candidate's member can do as it would for the panel's application: the preview then runs none.
    if (request.path === "/api/product-panels/read" && (request.body as { operations?: true }).operations)
      return Response.json({ status: "ready", value: { save: createAgent } });
    // Node answers a candidate's member read as the author's workspace, with the context it confirms for it.
    if (request.path === "/api/product-panels/read") return Response.json({ status: "ready", value: {
      fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false }],
      values: (request.body as { runtimeParams?: { values?: object } }).runtimeParams?.values ?? { name: "" }, errors: [], revision: 1,
      save: { method: "POST", path: "/assistant/agent-definitions", bodySchema: {}, draftOperation: "agent.create" },
    } });
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

function visibility() {
  const current = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  function set(value: "visible" | "hidden") {
    current.mockReturnValue(value);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  return { set, reset: () => { set("visible"); current.mockRestore(); } };
}

/**
 * Anything the preview asked of a formal registration: a use relation, an application, a panel record or its writes.
 * Node's read entry is not one: a candidate's members read there as the workspace.
 */
const formal = (sent: Sent[]) => sent.filter(request =>
  request.path.startsWith("/api/product-panels")
    && !["/api/product-panels/definition-stream", "/api/product-panels/read"].includes(request.path)
  || request.path.includes("/platform/applications") || request.method === "PUT" && request.path.startsWith("/api/product-"));

afterEach(leaveFrame);

/** The candidate's panel, as the element its component is mounted in. */
const shownPanel = (element: HTMLElement) => vi.waitFor(() => {
  const found = element.querySelector<HTMLElement>(".panel-host-coded > *");
  if (!found?.querySelector("[data-member]")) throw new Error("The candidate is not drawn yet");
  return found;
});
const nameInput = (element: HTMLElement) => vi.waitFor(() => {
  const input = element.querySelector<HTMLInputElement>("[data-member='definition'] [data-field='/name'] input");
  if (!input) throw new Error("The form is not drawn yet");
  return input;
});
const candidateReads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read").map(request => request.body as {
  source: unknown; memberPath: unknown; dataName: string;
});

it("previews the author's candidate through the same panel host, its members read at Node's entry as the workspace", async () => {
  const { answer, streams } = network(() => candidateOf('<div id="app"></div>'));
  const { app, element, sent } = await openPreview(answer);
  try {
    await shownPanel(element);
    expect(sent[0]).toMatchObject({ method: "GET", path: candidatePath, search: "?ref=working", credential: READER });
    expect(element.querySelector("iframe")).toBeNull();
    await nameInput(element);
    expect(candidateReads(sent)).toContainEqual(expect.objectContaining({
      source: { kind: "candidate", workspace: { id: WORKSPACE, ref: "working" } }, memberPath: [{ member: "definition" }],
      dataName: "createForm",
    }));
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

it("reads only through Node as the candidate, and runs no operation: a save is refused in the preview, and nothing is written", async () => {
  const { answer } = network(() => candidateOf('<div id="app"></div>'));
  const { app, element, sent } = await openPreview(answer);
  try {
    const input = await nameInput(element);
    input.value = "Preview agent";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    const save = [...element.querySelectorAll<HTMLButtonElement>("[data-member='definition'] button")].find(button => button.textContent?.trim() === "Save")!;
    save.click();
    await vi.waitFor(() => expect(element.querySelector("[data-member='definition']")?.textContent).toContain("A panel preview runs no operations"));
    // What the preview sent: the candidate, its projections and Node's read entry, as the reader; no owner was asked
    // directly, and nothing was written.
    expect(sent.every(request => request.credential === READER)).toBe(true);
    expect(sent.filter(request => request.path.startsWith("/api/data-query/") || request.path.startsWith("/api/assistant/")
      || request.path.startsWith("/api/panel-operation"))).toEqual([]);
    expect(candidateReads(sent).every(read => JSON.stringify(read.source) === JSON.stringify({ kind: "candidate", workspace: { id: WORKSPACE, ref: "working" } }))).toBe(true);
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("refuses a reader who is not the workspace's author, and shows the refusal", async () => {
  const { answer, streams } = network(() => Response.json({ error: { message: "Workspace not found" } }, { status: 404 }));
  const { app, element, sent } = await openPreview(answer);
  try {
    await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent).toBe("Workspace not found"));
    expect(element.querySelector(".panel-host-coded")).toBeNull();
    expect(streams).toEqual([]);
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
  }
});

it("reads the candidate again when the author comes back, and waits for an unsaved form", async () => {
  const foreground = visibility();
  let html = '<div id="app"></div>';
  const { answer } = network(() => candidateOf(html));
  const { app, element, sent } = await openPreview(answer);
  const reads = () => sent.filter(request => request.path === candidatePath);
  try {
    const shown = await shownPanel(element);

    // Unchanged files keep the panel as it is.
    foreground.set("hidden");
    foreground.set("visible");
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    expect(element.querySelector(".panel-host-coded > *")).toBe(shown);

    // The author changed the files while the reader holds an unsaved form: the new candidate waits for it.
    html = '<div id="app" class="changed"></div>';
    const input = await nameInput(element);
    input.value = "Unsaved";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    foreground.set("hidden");
    foreground.set("visible");
    await vi.waitFor(() => expect(reads()).toHaveLength(3));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(element.querySelector(".panel-host-coded > *")).toBe(shown);
    // Discarded: the changed candidate is drawn.
    [...element.querySelectorAll<HTMLButtonElement>("[data-member='definition'] button")].find(button => button.textContent?.trim() === "Discard")!.click();
    await confirmDiscard();
    await vi.waitFor(() => expect(element.querySelector(".panel-host-coded > .changed")).not.toBeNull());
    expect(formal(sent)).toEqual([]);
  } finally {
    app.unmount();
    foreground.reset();
  }
});
