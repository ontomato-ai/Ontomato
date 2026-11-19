import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import { candidateFiles, panelInput, projectionMaterial } from "../../../../../packages/apps-sdk/examples/panels/agent-settings/material.mjs";
import {
  currentSdk, hostMessageOf, inside, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelHostFrame, READER,
  SDK_VERSION, writeFrameDocument, type Sent,
} from "./panel-frame";

/*
 * The agent settings panel's G1 candidate (design 9.3), as an author previews it: the workspace files `material.mjs`
 * writes, read through Node's candidate port and shown by the platform's own preview route, panel host, app host and
 * bridge, with the panel's own module running on the SDK's modules in the frame. Only the network is a stand-in: the
 * definitions service, the skill catalogue, the model options, the execution options and the ontology metadata answer
 * as their owners do, and a write marked with a build-test context is refused as Node's build-test guard refuses it.
 *
 * What this rules out: a field of the definition edited anywhere but the one form (a second draft, a second dirty fact,
 * a second save); a value turned into text on its way to the owner; a create that does not start from the owner's
 * defaults; a candidate that saves live; and panel words the frame never receives.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const AGENT = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const OTHER = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a02";
const AGENT_DEFINITION = "platform:AgentDefinition";
const previewPath = `/app-builder/${WORKSPACE}/panel-preview/working/agent-settings`;

/** What D's candidate port answers for the workspace holding `material.mjs`'s files. */
function candidate(): CandidatePanelSource {
  const files = Object.fromEntries(candidateFiles(SDK_VERSION).map(file => [file.path, file.content]));
  const { content, ...descriptor } = JSON.parse(files["panel.json"]!);
  return {
    kind: "candidate",
    workspace: { id: WORKSPACE, ref: "working" },
    panel: { ...descriptor, content: { html: files["panel.html"], module: files["panel.mjs"], recipes: files["recipes.md"], ...content } },
    previewContext: { kind: "build-test", test: null },
  };
}

/** The projections as the univ_demo registration made them, by their final IDs. */
const projections: Record<string, ProductProjection> = Object.fromEntries(projectionMaterial().projections.map(({ id, input }) => [id, {
  ...input, id, domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false,
} as ProductProjection]));

const sql = { namespace: { kind: "domain", domainId: "domain-1" }, name: "sql" };
const chart = { namespace: { kind: "domain", domainId: "domain-1" }, name: "chart" };
const stored: PanelFormValues = {
  name: "e2e-agent-settings", description: "G1 acceptance agent", icon: null, enabled: false, systemPrompt: "Be brief",
  modelSelection: { modelId: null }, skills: [sql], classNames: ["Order"], enabledMcpServiceIds: [], executionUserId: "user-1",
};
const defaults: PanelFormValues = {
  name: "", description: "", icon: null, enabled: true, systemPrompt: "",
  modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], executionUserId: null,
};
const reference = (objectType: string, multiple = false) => ({ kind: "reference" as const, objectType, multiple });
const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"], more = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });
/** The definitions service's fields, as B's form describes them for G1 (no avatar or MCP control). */
const fields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }, { required: true }),
  field("/description", "Description", { kind: "text", multiline: true }),
  field("/icon", "Avatar", { kind: "hidden" }),
  field("/enabled", "Enabled", { kind: "switch" }),
  field("/systemPrompt", "Instructions", { kind: "markdown" }),
  field("/modelSelection/modelId", "Model", reference("platform:ModelOption")),
  field("/skills", "Skills", reference("platform:Skill", true)),
  field("/classNames", "Data scope", { kind: "reference", objectType: "platform:ObjectType", multiple: true, relatedObjectTypes: ["platform:Relationship"] }),
  field("/enabledMcpServiceIds", "MCP services", { kind: "hidden" }),
  field("/executionUserId", "Runs as", reference("platform:User"),
    { readOnly: true, readOnlyReason: "Only a domain governance administrator changes it" }),
];
const save = (create: boolean) => create
  ? { method: "POST" as const, path: "/assistant/agent-definitions", bodySchema: {}, draftOperation: "agent.create" }
  : { method: "PUT" as const, path: `/assistant/agent-definitions/${AGENT}`, bodySchema: {}, draftOperation: "agent.update" };
const definition = (id: string, values: PanelFormValues) => ({ id, sortOrder: 0, ...values });
const refused = () => Response.json({ error: { code: "BUILD_TEST_UNSUPPORTED", message: "This interface does not support test data" } }, { status: 422 });

/** Node's candidate port and the owners, as they answer the preview. */
function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === "/api/product-panels/definition-stream")
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  // Writes of definitions do not support test data: Node's build-test guard refuses them before the service.
  if (request.execution && ["POST", "PUT", "DELETE"].includes(request.method) && request.path.startsWith("/api/assistant/agent-definitions")
    && request.path !== "/api/assistant/agent-definitions/form") return refused();
  if (request.path === "/api/assistant/agent-definitions/form") {
    const { target, values } = request.body as { target: { kind: string }; values?: PanelFormValues };
    const create = target.kind === "draft";
    return Response.json({ fields, values: values ?? (create ? defaults : stored), save: save(create) });
  }
  if (request.path === "/api/assistant/agent-definitions")
    return Response.json({ agents: [definition(AGENT, stored), definition(OTHER, { ...stored, name: "Planner" })] });
  if (request.path === `/api/assistant/agent-definitions/${AGENT}`) return Response.json(definition(AGENT, stored));
  if (request.path === "/api/assistant/agent-skills")
    return Response.json({ skills: [{ skill: sql, title: "SQL", description: "" }, { skill: chart, title: "Charts", description: "" }] });
  if (request.path === "/api/data-query/model-options")
    return Response.json({ success: true, data: { models: [{ ref: "openai/gpt-4o", name: "GPT-4o", type: "chat" }], defaultModelId: null, embeddingModelId: null } });
  if (request.path === "/api/data-query/platform/agent-execution/options")
    return Response.json({ selected: { id: "user-1", name: "Alice", available: true }, canSetExecutionUser: false, users: [{ id: "user-1", name: "Alice" }] });
  if (request.path === "/api/data-query/admin/getMetas")
    return Response.json({ success: true, data: {
      classDef: [{ className: "Order", showName: "Orders" }, { className: "Customer", showName: "Customers" }, { className: "Invoice", showName: "Invoices" }],
      relationship_rule: { "rel-1": { fromclass: "Order", toclass: "Customer" } },
    } });
  return nothingAt(request);
}

/** Opens the preview route the platform registers, at a state, and starts the panel's own module in its frame. */
async function preview(state: Record<string, unknown>) {
  const sent = installPlatform(owners);
  const routes = appBuilderPages().map(route => route.name === "PanelCandidatePreview" ? { ...route, component: PanelCandidateRoute } as RouteRecordRaw : route);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(panelAddress(previewPath, state));
  const page = mountPlatformPage(() => h(RouterView), router);
  const frame = await panelHostFrame();
  const dirty: boolean[] = [];
  window.addEventListener("message", event => {
    if (event.source === frame.contentWindow && event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "dirty") dirty.push(event.data.dirty);
  });
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  // The candidate's own module, as the frame runs it: it imports the SDK and mounts the panel.
  // @ts-expect-error -- the panel's module is plain JavaScript, typed by the SDK it imports, not by a declaration of its own.
  await import("../../../../../packages/apps-sdk/examples/panels/agent-settings/panel.mjs");
  return { ...page, router, sent, dirty };
}

const fieldItem = (path: string) => document.querySelector(`#app [data-field="${path}"]`);
const node = (id: string) => document.querySelector<SVGGElement>(`#app [data-node-id="${id}"]`)!;
const formSave = () => [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")]
  .find(button => button.textContent?.trim() === "Save")!;
const fromFrame = (sent: Sent[]) => sent.filter(request => request.path !== `/api/workspaces/${WORKSPACE}/panel-candidate`
  && request.path !== "/api/apps-sdk/current" && request.path !== "/api/product-panels/definition-stream");

/** Picks one choice of a picker the way a reader does: open its list and click the choice. */
async function pick(path: string, label: string) {
  fieldItem(path)!.querySelector<HTMLElement>(".el-select__wrapper")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const option = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find(item => item.textContent?.trim() === label);
    expect(found).toBeTruthy();
    return found!;
  });
  option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextTick();
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("registers what the owners accept: every projection the panel names, and the built-in panel from the same sources", () => {
  const { projections: material } = projectionMaterial();
  for (const { input } of material) productProjectionInputSchema.parse(input);
  const panel = productPanelInputSchema.parse(panelInput(SDK_VERSION));
  expect(new Set(material.map(({ id }) => id))).toEqual(new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId)));
  expect(panel.content).toEqual(candidate().panel.content);
});

it("lists the agents in its own words and creates nothing until asked", { timeout: 20000 }, async () => {
  const { app, sent } = await preview({});
  try {
    await vi.waitFor(() => expect(document.querySelectorAll("#app .sdk-object-list [role=option]")).toHaveLength(2), { timeout: 5000 });
    // The panel's words came with the candidate's `panel.json`, in the platform's language.
    expect(document.querySelector("#app .agent-settings-empty")?.textContent).toBe("Choose an agent, or create a new one.");
    expect(document.querySelector("#app .sdk-section-group-title")?.textContent).toBe("Agents");
    expect(fieldItem("/name")).toBeNull();
    expect(sent.some(request => request.path === "/api/assistant/agent-definitions/form")).toBe(false);
  } finally {
    app.unmount();
  }
});

it("edits one agent's definition as one form: its fields, model, skills and data scope, one unsaved state, one save", { timeout: 30000 }, async () => {
  const { app, sent, dirty, router } = await preview({ selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  try {
    await vi.waitFor(() => {
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings");
      expect(fieldItem("/skills")?.textContent).toContain("SQL");
      expect(node("Customer")).toBeTruthy();
    }, { timeout: 5000 });
    expect(router.currentRoute.value.query.state).toContain('"mode":"edit"');
    expect(document.querySelector("#app .sdk-object-summary")).not.toBeNull();
    // The owner's rules: who the agent runs as is shown and read-only, with the owner's reason; the avatar and MCP are not drawn.
    expect(fieldItem("/executionUserId")?.querySelector("input")?.disabled).toBe(true);
    expect(fieldItem("/executionUserId")?.textContent).toContain("Alice");
    expect(fieldItem("/icon")).toBeNull();
    expect(fieldItem("/enabledMcpServiceIds")).toBeNull();
    expect(dirty.at(-1)).toBe(false);

    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "e2e-agent-settings v2";
    name.dispatchEvent(new Event("input"));
    fieldItem("/enabled")!.querySelector<HTMLElement>(".el-switch")!.click();
    await pick("/modelSelection/modelId", "GPT-4o");
    await pick("/skills", "Charts");
    // The data scope: a class, then the classes one relationship away from the chosen ones.
    node("Invoice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(node("Invoice").classList.contains("selected")).toBe(true));
    document.querySelector<HTMLButtonElement>("#app .sdk-object-graph-adjacent")!.click();
    await vi.waitFor(() => expect(node("Customer").classList.contains("selected")).toBe(true));
    await vi.waitFor(() => expect(dirty.at(-1)).toBe(true));
    // One unsaved state for the whole definition: it went from clean to unsaved once and stayed there.
    expect(dirty.filter((value, index) => index > 0 && value !== dirty[index - 1])).toEqual([true]);

    formSave().click();
    // One save, of the owner's own JSON with every change in it, nothing turned into text. In a candidate preview it is
    // marked with the workspace's build-test context, and the definitions service does not take test-data writes: the
    // refusal is the answer, shown with the form the reader still holds, and nothing is sent again.
    await vi.waitFor(() => expect(document.querySelector("#app .sdk-owner-form")?.textContent).toContain("This interface does not support test data"));
    const writes = sent.filter(request => request.method === "PUT" || request.method === "POST" && request.path === "/api/assistant/agent-definitions");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "PUT", path: `/api/assistant/agent-definitions/${AGENT}` });
    expect(writes[0]!.body).toEqual({
      ...stored, name: "e2e-agent-settings v2", enabled: true, modelSelection: { modelId: "openai/gpt-4o" },
      skills: [sql, chart], classNames: ["Order", "Invoice", "Customer"],
    });
    expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings v2");
    expect(dirty.at(-1)).toBe(true);
    // Every request the frame made went out as the reader, marked with the preview's context; none was live.
    expect(fromFrame(sent).every(request => request.credential === READER
      && request.execution === JSON.stringify({ kind: "build-test", contextId: null }))).toBe(true);
    // Only the host's own reads (the candidate, the SDK root, the author definition stream) went out unmarked.
    expect(sent.filter(request => request.execution === null).map(request => request.path)).toEqual(sent.filter(request => [
      `/api/workspaces/${WORKSPACE}/panel-candidate`, "/api/apps-sdk/current", "/api/product-panels/definition-stream",
    ].includes(request.path)).map(request => request.path));
    expect(sent.some(request => request.path.startsWith("/api/product-panels") || request.path.includes("/platform/applications"))).toBe(false);
  } finally {
    app.unmount();
  }
});

it("opens a new agent with the owner's defaults, and its create is the owner's to refuse in a preview", { timeout: 30000 }, async () => {
  const { app, sent } = await preview({ mode: "create" });
  try {
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")).toBeTruthy(), { timeout: 5000 });
    expect(sent.find(request => request.path === "/api/assistant/agent-definitions/form")?.body).toEqual({ target: { kind: "draft" }, changedField: null });
    expect([...document.querySelectorAll("#app .sdk-section-group-title")].map(title => title.textContent)).toContain("New agent");
    expect(fieldItem("/enabled")?.querySelector(".el-switch")?.classList.contains("is-checked")).toBe(true);
    expect(document.querySelector("#app .sdk-object-summary")).toBeNull();
    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "e2e-new-agent";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    formSave().click();
    await vi.waitFor(() => expect(document.querySelector("#app .sdk-owner-form")?.textContent).toContain("This interface does not support test data"));
    const creates = sent.filter(request => request.method === "POST" && request.path === "/api/assistant/agent-definitions");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.body).toEqual({ ...defaults, name: "e2e-new-agent" });
  } finally {
    app.unmount();
  }
});
