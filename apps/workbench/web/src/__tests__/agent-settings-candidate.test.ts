import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import { candidateFiles, panelInput, projectionMaterial } from "../../../../../packages/apps-sdk/examples/panels/agent-settings/material.mjs";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, READER, type Sent } from "./panel-frame";

/*
 * The agent settings panel's G1 candidate (design 9.3), as an author previews it: the workspace files `material.mjs`
 * writes, read through Node's candidate port and shown by the platform's own preview route, panel host, app host and
 * bridge, with the panel's own module running on the SDK's modules in the frame. Only the network is a stand-in: the
 * definitions service, the skill catalogue, the model options, the execution options and the ontology metadata answer
 * as their owners do. A candidate preview runs as no application use, so it runs none of the panel's operations: a save
 * is refused in the frame, with the form the reader holds kept.
 *
 * What this rules out: a field of the definition edited anywhere but the one form (a second draft, a second dirty fact,
 * a second save); a create that does not start from the owner's defaults; a candidate that saves live; and panel words
 * the frame never receives.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const AGENT = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const OTHER = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a02";
const AGENT_DEFINITION = "platform:AgentDefinition";
const previewPath = `/app-builder/${WORKSPACE}/panel-preview/working/agent-settings`;

/** The candidate port's reply for the panel's HTML, module, recipes and messages. */
function candidate(): CandidatePanelSource {
  const files = Object.fromEntries(candidateFiles().map(file => [file.path, file.content]));
  const { manifest, content } = JSON.parse(files["panel.json"]!);
  return {
    kind: "candidate",
    workspace: { id: WORKSPACE, ref: "working" },
    panel: { manifest, content: { html: files["panel.html"]!, module: files["panel.mjs"], recipes: files["recipes.md"], ...content } },
    previewContext: { kind: "build-test", test: null },
  };
}

/** The projections as Node holds them once registered: the material's own input, as a current record. */
const projections: Record<string, ProductProjection> = Object.fromEntries(
  projectionMaterial().projections.map(({ id, input }) => [id, {
    ...productProjectionInputSchema.parse(input), id, domainId: "domain-1", ownerId: "owner-1",
    revision: 1, createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z", editable: false,
  }]),
);

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

type Read = {
  source: unknown; memberPath: [{ member: string }]; dataName?: string; operations?: true; inputs: Record<string, unknown>; runtimeParams?: { values?: unknown };
};
/** What a member can do, as Node admits it for the member's inputs: the definition's save edits the shown agent, else creates. */
function admitted({ memberPath: [{ member }], inputs }: Read): unknown {
  if (member !== "definition") return {};
  const target = inputs.agent ? { source: "input", input: "agent" } : { source: "draft", slot: "definition" };
  return { save: { kind: "form.save", handlerRef: `${AGENT_DEFINITION}.save`, label: "Save", effect: "write", target, inputSchema: {}, resultSchema: {}, batch: false } };
}
const option = (primaryKey: string, value: unknown, label: string) => ({ primaryKey, value, label });
/** Each picker's catalogue, as its owner lists it through Node's read entry. */
const catalogues: Record<string, ReturnType<typeof option>[]> = {
  model: [option("openai/gpt-4o", "openai/gpt-4o", "GPT-4o")],
  skills: [option("sql", sql, "SQL"), option("chart", chart, "Charts")],
  executor: [option("user-1", "user-1", "Alice")],
};
/** What Node's read entry answers for one of the candidate's members, as its owner reads it. */
function memberData({ memberPath: [{ member }], dataName, inputs, runtimeParams }: Read): unknown {
  if (member === "agents") return [[AGENT, String(stored.name)], [OTHER, "Planner"]].map(([primaryKey, label]) => ({ primaryKey, label, fields: {} }));
  if (member === "summary") return { primaryKey: AGENT, label: String(stored.name), fields: { description: String(stored.description) } };
  if (member === "definition") {
    const create = dataName === "createForm";
    return { fields, values: runtimeParams?.values ?? (create ? defaults : stored), errors: [], revision: 1, save: save(create) };
  }
  if (member === "scope") return dataName === "nodes"
    ? [["Order", "Orders"], ["Customer", "Customers"], ["Invoice", "Invoices"]].map(([primaryKey, label]) => ({ primaryKey, label, fields: {} }))
    : [{ primaryKey: "rel-1", label: "", fields: { fromclass: "Order", toclass: "Customer" } }];
  const catalogue = catalogues[member]!;
  if (dataName === "options") return { options: catalogue };
  const held = [(runtimeParams?.values ?? inputs.values ?? [])].flat();
  return { options: held.map(value => catalogue.find(one => JSON.stringify(one.value) === JSON.stringify(value))).filter(Boolean) };
}

/** Node's candidate port and its read entry, as they answer the preview. */
function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/product-panels/definition-stream")
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/product-panels/read") {
    const read = request.body as Read;
    return Response.json({ status: "ready", value: read.operations ? admitted(read) : memberData(read) });
  }
  return nothingAt(request);
}

/** Opens the preview route the platform registers, at a state: the candidate's own module runs in the platform's document. */
async function preview(state: Record<string, unknown>, respond: typeof owners | ((request: Sent) => Promise<Response>) = owners) {
  const sent = installPlatform(respond);
  const routes = appBuilderPages().map(route => route.name === "PanelCandidatePreview" ? { ...route, component: PanelCandidateRoute } as RouteRecordRaw : route);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(panelAddress(previewPath, state));
  const page = mountPlatformPage(() => h(RouterView), router);
  return { ...page, router, sent };
}

const fieldItem = (path: string) => document.querySelector(`.panel-host-coded [data-field="${path}"]`);
const node = (id: string) => document.querySelector<SVGGElement>(`.panel-host-coded [data-node-id="${id}"]`)!;
const formSave = () => [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-owner-form-actions button")]
  .find(button => button.textContent?.trim() === "Save" || button.textContent?.trim() === "Create")!;
const reads = (sent: Sent[]) => sent.filter(request => request.path === "/api/product-panels/read").map(request => request.body as Read);

const PREVIEW_REFUSAL = "A panel preview runs no operations; they run in the panel's application";
/** A write of a definition, or any operation sent through the platform's coordinator. */
const isWrite = (request: Sent) => request.path.startsWith("/api/panel-operation")
  || ["POST", "PUT", "DELETE"].includes(request.method) && request.path.startsWith("/api/assistant/");

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

afterEach(leaveFrame);

it("registers what the owners accept: every projection the panel names, and the built-in panel from the same sources", () => {
  const { projections: material } = projectionMaterial();
  for (const { input } of material) productProjectionInputSchema.parse(input);
  const panel = productPanelInputSchema.parse(panelInput());
  expect(new Set(material.map(({ id }) => id))).toEqual(new Set(Object.values(panel.manifest.members)
    .flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : [])));
  expect(panel.content).toEqual(candidate().panel.content);
});

it("lists the agents in its own words and creates nothing until asked", { timeout: 20000 }, async () => {
  const { app, sent } = await preview({});
  try {
    await vi.waitFor(() => expect(document.querySelectorAll(".panel-host-coded .sdk-object-list [role=option]")).toHaveLength(2), { timeout: 5000 });
    // The panel's words came with the candidate's `panel.json`, in the platform's language.
    expect(document.querySelector(".panel-host-coded .agent-settings-empty")?.textContent).toBe("Choose an agent, or create a new one.");
    expect(document.querySelector(".panel-host-coded .sdk-section-group-title")?.textContent).toBe("Agents");
    expect(fieldItem("/name")).toBeNull();
    // The definition's operations are known from the start; its form is not read until asked for.
    expect(reads(sent).some(read => read.memberPath[0].member === "definition" && read.dataName)).toBe(false);
  } finally {
    app.unmount();
  }
});

it("edits one agent's definition as one form: its fields, model, skills and data scope, one unsaved state, one save", { timeout: 30000 }, async () => {
  const { app, sent, router } = await preview({ selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  try {
    await vi.waitFor(() => {
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings");
      expect(fieldItem("/skills")?.textContent).toContain("SQL");
      expect(node("Customer")).toBeTruthy();
    }, { timeout: 5000 });
    expect(router.currentRoute.value.query.state).toContain('"mode":"edit"');
    expect(document.querySelector(".panel-host-coded .sdk-object-summary")).not.toBeNull();
    // The owner's rules: who the agent runs as is shown and read-only, with the owner's reason; the avatar and MCP are not drawn.
    expect(fieldItem("/executionUserId")?.querySelector("input")?.disabled).toBe(true);
    expect(fieldItem("/executionUserId")?.textContent).toContain("Alice");
    expect(fieldItem("/icon")).toBeNull();
    expect(fieldItem("/enabledMcpServiceIds")).toBeNull();

    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "e2e-agent-settings v2";
    name.dispatchEvent(new Event("input"));
    fieldItem("/enabled")!.querySelector<HTMLElement>(".el-switch")!.click();
    await pick("/modelSelection/modelId", "GPT-4o");
    await pick("/skills", "Charts");
    // The data scope: a class, then the classes one relationship away from the chosen ones.
    node("Invoice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(node("Invoice").classList.contains("selected")).toBe(true));
    document.querySelector<HTMLButtonElement>(".panel-host-coded .sdk-object-graph-adjacent")!.click();
    await vi.waitFor(() => expect(node("Customer").classList.contains("selected")).toBe(true));

    formSave().click();
    // A preview saves nothing: the refusal is the answer, shown with the form the reader still holds, and no write leaves.
    await vi.waitFor(() => expect(document.querySelector(".panel-host-coded .sdk-owner-form")?.textContent).toContain(PREVIEW_REFUSAL));
    expect(sent.filter(isWrite)).toEqual([]);
    expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings v2");
    // Every member read went to Node's read entry as the author's workspace, as the reader; nothing formal was asked.
    const workspace = JSON.stringify({ kind: "candidate", workspace: { id: WORKSPACE, ref: "working" } });
    expect(reads(sent).length).toBeGreaterThan(0);
    expect(reads(sent).every(read => JSON.stringify(read.source) === workspace)).toBe(true);
    expect(sent.every(request => request.credential === READER)).toBe(true);
    expect(sent.some(request => request.path.startsWith("/api/data-query/") || request.path.includes("/platform/applications"))).toBe(false);
  } finally {
    app.unmount();
  }
});

it("opens a new agent with the owner's defaults, and its create is the owner's to refuse in a preview", { timeout: 30000 }, async () => {
  const { app, sent } = await preview({ mode: "create" });
  try {
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")).toBeTruthy(), { timeout: 5000 });
    expect(reads(sent).find(read => read.memberPath[0].member === "definition" && read.dataName)?.dataName).toBe("createForm");
    expect([...document.querySelectorAll(".panel-host-coded .sdk-section-group-title")].map(title => title.textContent)).toContain("New agent");
    expect(fieldItem("/enabled")?.querySelector(".el-switch")?.classList.contains("is-checked")).toBe(true);
    expect(document.querySelector(".panel-host-coded .sdk-object-summary")).toBeNull();
    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "e2e-new-agent";
    name.dispatchEvent(new Event("input"));
    // A new agent's model, skills and data scope are chosen as an existing one's are, into the form that creates it.
    await pick("/modelSelection/modelId", "GPT-4o");
    await pick("/skills", "SQL");
    await vi.waitFor(() => expect(node("Invoice")).toBeTruthy(), { timeout: 5000 });
    node("Invoice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(node("Invoice").classList.contains("selected")).toBe(true));
    expect(fieldItem("/modelSelection/modelId")?.textContent).toContain("GPT-4o");
    expect(fieldItem("/skills")?.textContent).toContain("SQL");
    await nextTick();
    formSave().click();
    await vi.waitFor(() => expect(document.querySelector(".panel-host-coded .sdk-owner-form")?.textContent).toContain(PREVIEW_REFUSAL));
    expect(sent.filter(isWrite)).toEqual([]);
    expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-new-agent");
  } finally {
    app.unmount();
  }
});

it("waits for the new form before showing reference values and puts Save after all the fields", async () => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const { app, router, sent } = await preview({ selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } }, async request => {
    if (request.path === "/api/product-panels/read" && (request.body as Read).dataName === "createForm") await delayed;
    return owners(request);
  });
  try {
    await vi.waitFor(() => expect(fieldItem("/skills")?.textContent).toContain("SQL"), { timeout: 5000 });
    // Edit mode hides the save bar while clean; once edited, Save appears after all fields.
    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "e2e-agent-settings-edited";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    expect(fieldItem("/classNames")!.compareDocumentPosition(formSave()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Discard the edit before navigating to create mode so navigation does not prompt for unsaved changes.
    [...document.querySelectorAll<HTMLButtonElement>(".panel-host-coded .sdk-owner-form-actions button")]
      .find(button => button.textContent?.trim() === "Discard")!.click();
    const box = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(".el-message-box");
      if (!found) throw new Error("No confirm dialog");
      return found;
    });
    [...box.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Discard")!.click();
    await vi.waitFor(() => expect(document.querySelector(".panel-host-coded .sdk-owner-form-actions")).toBeNull());
    await router.push(panelAddress(previewPath, { mode: "create" }));
    await vi.waitFor(() => expect(reads(sent).some(read => read.dataName === "createForm")).toBe(true));
    expect(fieldItem("/modelSelection/modelId")).toBeNull();
    expect(fieldItem("/skills")).toBeNull();
    release();
    await vi.waitFor(() => expect(fieldItem("/skills")).not.toBeNull());
    expect(fieldItem("/skills")?.textContent).not.toContain("SQL");
  } finally {
    release();
    app.unmount();
  }
});
