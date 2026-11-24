import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import type { CandidatePanelSource, ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { DELETE_AGENT, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { candidateFiles, panelInput, projectionMaterial } from "../../../../../packages/apps-sdk/examples/panels/agent-settings/material.mjs";
import builtinHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.html?raw";
import builtinSource from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.json";
import builtinModule from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/panel.mjs?raw";
import builtinRecipes from "../../../../../packages/ontology-manager/resources/builtin-panels/agent-settings/recipes.md?raw";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, READER, type Sent } from "./panel-frame";

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
  ? { method: "POST" as const, path: "/assistant/agent-definitions", bodySchema: {} }
  : { method: "PUT" as const, path: `/assistant/agent-definitions/${AGENT}`, bodySchema: {} };
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

afterEach(() => {
  leaveFrame();
  useApplicationCatalog().applications.value = [];
  document.body.innerHTML = "";
});

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
    expect(router.currentRoute.value.query.mode).toBe("edit");
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

describe("agent-settings builtin panel", () => {
  const BUILTIN_APP_ID = "ontology";
  const CAPABILITY_MAP_PATH = "/ontology/assets/capability-map";
  const builtinUse = panelUse(
    "ontology-agent-settings",
    "agent-settings",
    "builtin-product-agent-settings",
    "/ontology/agents",
  );
  const capabilityMapUse = panelUse(
    "ontology-capability-map",
    "capability-map",
    "builtin-product-capability-map",
    CAPABILITY_MAP_PATH,
  );

  const typeTable = {
    objectTypes: Object.fromEntries(
      Object.entries(platformObjectTypes).map(([id, entry]) => [
        id,
        platformTypeTableEntrySchema.parse({
          ...entry,
          operations: id === AGENT_DEFINITION
            ? [
                {
                  id: `${AGENT_DEFINITION}.save`,
                  kind: "form.save",
                  effect: "write",
                  batch: false,
                  inputSchema: { type: "object" },
                  target: { source: "input", input: "agent" },
                },
                {
                  id: DELETE_AGENT,
                  kind: "action",
                  effect: "write",
                  batch: false,
                  inputSchema: { type: "object" },
                  target: { source: "input", input: "agent" },
                },
              ]
            : [],
        }),
      ]),
    ),
  };

  const builtinAuthoring = panelAuthoringManifestSchema.parse(builtinSource.manifest);
  const builtinCatalogue = components.map((component) =>
    appsSdkComponentCatalogEntrySchema.parse({
      ...component,
      ...(component.componentId === "OperationButton"
        ? { config: [{ name: "operation", type: "string", required: true, description: "Operation local name" }] }
        : {}),
      ports: { props: [], events: [], slots: [] },
    }),
  );
  const builtinProjections = new Map<string, ProductProjection>();
  const builtinMembers = Object.fromEntries(
    Object.entries(builtinAuthoring.members).map(([name, entry]) => {
      if (!("component" in entry)) throw new Error(`Expected authored projection for ${name}`);
      const { projection, placement } = expandPanelAuthoringMember(name, entry, {
        state: builtinAuthoring.state,
        typeTable,
        components: builtinCatalogue,
      });
      builtinProjections.set(entry.id!, {
        ...projection,
        id: entry.id!,
        name,
        description: name,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-24T00:00:00.000Z",
        updatedAt: "2026-11-24T00:00:00.000Z",
      });
      return [name, { ...placement, target: { projectionId: entry.id! } }];
    }),
  );

  const builtinPanel = {
    ...panelRecord(
      builtinUse.panelId,
      "Agent settings",
      definePanel({ state: builtinAuthoring.state, members: builtinMembers }),
    ),
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
    content: { html: builtinHtml, module: builtinModule, messages: builtinSource.content.messages },
  };

  const agentRow = (primaryKey: string, label: string, description: string, enabled = true) => ({
    primaryKey,
    label,
    fields: { description, enabled },
  });

  type BuiltinDataRead = Extract<ProductPanelReadRequest, { dataName: string }>;

  function mountBuiltinRoute(options: {
    initialState?: Record<string, unknown>;
    onListRead: () => Response | Promise<Response>;
    onSummaryRead?: (targetPrimaryKey: string | undefined) => Response | Promise<Response>;
    onDelete?: (targetPrimaryKey: string) => void;
  }) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: builtinUse.path, component: PanelApplicationRoute, props: { applicationId: BUILTIN_APP_ID } },
        { path: CAPABILITY_MAP_PATH, component: { render: () => h("div", { class: "capability-map-target" }, "Capability Map") } },
      ],
    });
    const listReads: BuiltinDataRead[] = [];
    const intentTargets = new Map<string, string>();
    let intentCounter = 0;
    const sent = installPlatform((request: Sent) => {
      const { path } = request;
      if (path === `/api/data-query/platform/applications/${BUILTIN_APP_ID}/panel-uses`) {
        return Response.json({
          data: {
            applicationId: BUILTIN_APP_ID,
            entry: { path: "/ontology", renderer: "panels" },
            panelUses: [builtinUse, capabilityMapUse],
          },
        });
      }
      if (path === `/api/product-panels/${builtinPanel.id}`) return panelAnswer(builtinPanel, request);
      if (path === `/api/product-panels/${builtinPanel.id}/snapshot`) {
        return panelSnapshot(builtinPanel, Object.fromEntries(builtinProjections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: builtinProjections.get(path.split("/").at(-1)!) });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        const member = body.memberPath[0]?.member;
        if ("operations" in body) {
          const targetRef = body.inputs.agent ?? body.inputs.target;
          if (member === "form") {
            const target = targetRef ? { source: "input", input: "agent" } : { source: "draft", slot: "form" };
            return Response.json({
              status: "ready",
              value: {
                save: {
                  kind: "form.save",
                  handlerRef: `${AGENT_DEFINITION}.save`,
                  label: "Save",
                  effect: "write",
                  target,
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          if (member === "remove") {
            if (!targetRef) return Response.json({ status: "ready", value: {} });
            return Response.json({
              status: "ready",
              value: {
                delete: {
                  kind: "action",
                  handlerRef: DELETE_AGENT,
                  label: "Delete",
                  effect: "write",
                  target: { source: "input", input: "agent" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (member === "list") {
          listReads.push(body);
          return options.onListRead();
        }
        if (member === "summary") {
          const target = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
          if (options.onSummaryRead) return options.onSummaryRead(target?.primaryKey);
          const id = target?.primaryKey ?? AGENT;
          const label = id === OTHER ? "Planner" : String(stored.name);
          return Response.json({
            status: "ready",
            value: { primaryKey: id, label, fields: { description: String(stored.description), enabled: true } },
          });
        }
        if (member === "form") {
          const create = body.dataName === "createForm";
          const target = (body.inputs.agent ?? body.inputs.target) as { primaryKey?: string } | undefined;
          const values = create
            ? defaults
            : { ...stored, name: target?.primaryKey === OTHER ? "Planner" : stored.name };
          return Response.json({
            status: "ready",
            value: { fields, values, errors: [], revision: 1, save: save(create) },
          });
        }
        if (member === "scope") {
          return Response.json({
            status: "ready",
            value: body.dataName === "nodes"
              ? [["Order", "Orders"], ["Customer", "Customers"]].map(([primaryKey, label]) => ({ primaryKey, label, fields: {} }))
              : [{ primaryKey: "rel-1", label: "", fields: { fromclass: "Order", toclass: "Customer" } }],
          });
        }
        if (member === "tools") {
          return Response.json({ status: "ready", value: { options: [] } });
        }
        const catalogue = catalogues[member!] ?? [];
        if (body.dataName === "options") return Response.json({ status: "ready", value: { options: catalogue } });
        return Response.json({ status: "ready", value: { options: [] } });
      }
      if (path === "/api/panel-operations/intents") {
        const body = request.body as {
          operationId: string;
          call?: { target?: { primaryKey?: string } };
          calls?: Array<{ target?: { primaryKey?: string } }>;
        };
        intentCounter += 1;
        const intentId = `11111111-1111-4111-8111-11111111111${intentCounter}`;
        const targetId = body.call?.target?.primaryKey ?? body.calls?.[0]?.target?.primaryKey ?? AGENT;
        intentTargets.set(intentId, targetId);
        return Response.json({
          intentId,
          operationId: body.operationId,
          label: "Delete",
          confirmation: { kind: "none" },
        });
      }
      if (/^\/api\/panel-operation-intents\/[^/]+$/.test(path)) {
        const intentId = path.split("/").at(-1)!;
        return Response.json({
          intentId,
          operationId: "remove.delete",
          label: "Delete",
          confirmation: { kind: "none" },
        });
      }
      if (/^\/api\/panel-operations\/intents\/[^/]+\/dispatch$/.test(path)) {
        const intentId = path.split("/").at(-2)!;
        const targetId = intentTargets.get(intentId) ?? AGENT;
        options.onDelete?.(targetId);
        return Response.json({
          kind: "dispatched",
          intentId,
          outcome: {
            kind: "success",
            message: "Deleted agent",
            data: {},
            affected: {
              objects: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
              objectTypes: [AGENT_DEFINITION],
              removed: [{ objectType: AGENT_DEFINITION, primaryKey: targetId }],
            },
          },
        });
      }
      return nothingAt(request);
    }, router);

    return {
      router,
      sent,
      listReads,
      async open() {
        useApplicationCatalog().applications.value = [
          {
            id: BUILTIN_APP_ID,
            kind: "product",
            names: { en: "Ontology" },
            descriptions: {},
            icon: "ontology",
            rail: "apps",
            category: "build",
            sort: 0,
            entry: { path: "/ontology", renderer: "panels" },
            entryAccess: ["domain-member"],
            scheduleAdapter: null,
            releaseId: null,
            panelUses: [builtinUse, capabilityMapUse],
          },
        ];
        const address = options.initialState
          ? panelAddress(builtinUse.path, options.initialState, builtinPanel.manifest)
          : builtinUse.path;
        await router.push(address);
        return mountPlatformPage(() => h(RouterView), router);
      },
    };
  }

  const answerLeaveConfirm = async (choice: "keep" | "discard") => {
    const box = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
        .find((candidateBox) => candidateBox.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
      if (!found) throw new Error(`Expected unsaved leave confirm dialog for '${choice}'`);
      return found;
    }, { timeout: 5000 });
    const selector = choice === "keep"
      ? ".el-message-box__btns button.ontomato-danger-confirm-cancel"
      : ".el-message-box__btns button.el-button--danger";
    const button = box.querySelector<HTMLButtonElement>(selector);
    expect(button).toBeTruthy();
    button!.click();
    await vi.waitFor(() => {
      const open = [...document.querySelectorAll<HTMLElement>(".el-message-box")]
        .find((candidateBox) => candidateBox.closest<HTMLElement>(".el-overlay")?.style.display !== "none");
      expect(open).toBeUndefined();
    }, { timeout: 5000 });
  };

  it("removes usePanelData/PanelData, keeps manifest.state free of listedAgents, and uses sdk-button instead of a raw button", () => {
    expect(builtinModule).not.toMatch(/usePanelData|PanelData/);
    expect(JSON.stringify(builtinSource)).not.toMatch(/usePanelData|PanelData/);
    expect(builtinModule).toContain('usePanelOutput("list", "status")');
    expect(builtinModule).toContain('usePanelOutput("list", "listed")');
    expect(builtinModule).not.toContain("onListed");
    expect(Object.keys(builtinSource.manifest.state).sort()).toEqual(["mode", "selected"]);
    expect(builtinSource.manifest.state).not.toHaveProperty("listedAgents");
    expect(builtinSource.manifest.state.selected.deepLink).toBe(true);
    expect(builtinSource.manifest.state.mode.deepLink).toBe(true);
    expect(builtinSource.manifest.members.list.state).toEqual({ selected: "selected" });
    expect(builtinSource.manifest.members.list.state).not.toHaveProperty("listed");
    expect(builtinHtml).toContain('<projection slot="list"></projection>');
    expect(builtinHtml).not.toContain("@update:listed");
    expect(builtinHtml).not.toContain("<button");
    expect(builtinHtml).not.toContain("agent-settings-button");
    expect(builtinHtml).toContain('<sdk-button text size="small" @click="viewType">');
    expect(builtinRecipes).not.toContain("listedAgents");
    expect(builtinRecipes).not.toContain("agents.delete");
    expect(builtinRecipes).toContain("remove.delete");
  });

  it("selects the first agent on a bare address without flashing empty state while loading, and navigates via View class sdk-button", { timeout: 20000 }, async () => {
    let releaseList!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const route = mountBuiltinRoute({
      onListRead: async () => {
        await gate;
        return Response.json({
          status: "ready",
          value: [agentRow(AGENT, String(stored.name), String(stored.description)), agentRow(OTHER, "Planner", "Plans tasks")],
        });
      },
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => expect(route.listReads.length).toBeGreaterThan(0), { timeout: 5000 });
      expect(element.textContent).not.toContain("Select an agent on the left, or create one.");
      expect(element.textContent).not.toContain("New agent");
      releaseList();

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(AGENT);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
        expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings");
      }, { timeout: 5000 });

      const viewClassButton = [...element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button.el-button")]
        .find((button) => button.textContent?.trim() === "View class");
      expect(viewClassButton).toBeTruthy();
      viewClassButton!.click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.path).toBe(CAPABILITY_MAP_PATH);
        expect(route.router.currentRoute.value.query).toEqual({
          mode: "type",
          selectedType: AGENT_DEFINITION,
        });
      }, { timeout: 5000 });
    } finally {
      releaseList();
      app.unmount();
    }
  });

  it("does not overwrite explicit ?mode=create or ?mode=list when the list resolves", { timeout: 20000 }, async () => {
    const rows = [agentRow(AGENT, String(stored.name), String(stored.description)), agentRow(OTHER, "Planner", "Plans tasks")];
    const createRoute = mountBuiltinRoute({
      initialState: { mode: "create" },
      onListRead: () => Response.json({ status: "ready", value: rows }),
    });
    const createPage = await createRoute.open();
    try {
      await vi.waitFor(() => {
        expect(createPage.element.querySelectorAll(".sdk-object-list [role=option]")).toHaveLength(2);
        expect(fieldItem("/name")?.querySelector("input")).toBeTruthy();
      }, { timeout: 5000 });
      expect(createRoute.router.currentRoute.value.query.mode).toBe("create");
      expect(createRoute.router.currentRoute.value.query.selected).toBeUndefined();
      expect([...createPage.element.querySelectorAll(".sdk-section-group-title")].map((el) => el.textContent)).toContain("New agent");
    } finally {
      createPage.app.unmount();
    }

    const listRoute = mountBuiltinRoute({
      initialState: { mode: "list" },
      onListRead: () => Response.json({ status: "ready", value: rows }),
    });
    const listPage = await listRoute.open();
    try {
      await vi.waitFor(() => {
        expect(listPage.element.querySelectorAll(".sdk-object-list [role=option]")).toHaveLength(2);
        expect(listPage.element.textContent).toContain("Select an agent on the left, or create one.");
      }, { timeout: 5000 });
      expect(listRoute.router.currentRoute.value.query.mode).toBe("list");
      expect(listRoute.router.currentRoute.value.query.selected).toBeUndefined();
    } finally {
      listPage.app.unmount();
    }
  });

  it("shows role='alert' and hides management controls when the list read is forbidden", async () => {
    const route = mountBuiltinRoute({
      onListRead: () => Response.json({ status: "forbidden" }),
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelector('[role="alert"]')?.textContent).toContain("analysis-agent");
      }, { timeout: 5000 });
      expect(element.textContent).not.toContain("New agent");
      expect(element.textContent).not.toContain("Select an agent on the left, or create one.");
    } finally {
      app.unmount();
    }
  });

  it("waits for the refreshed list before falling back after delete, and stays in list mode when the last agent is deleted", { timeout: 20000 }, async () => {
    let remaining = [
      agentRow(AGENT, String(stored.name), String(stored.description)),
      agentRow(OTHER, "Planner", "Plans tasks"),
    ];
    let gateAfterFirstDelete: Promise<void> | null = null;
    let releaseAfterFirstDelete: () => void = () => {};
    const route = mountBuiltinRoute({
      onListRead: async () => {
        if (gateAfterFirstDelete) {
          const pending = gateAfterFirstDelete;
          gateAfterFirstDelete = null;
          await pending;
        }
        return remaining.length
          ? Response.json({ status: "ready", value: remaining })
          : Response.json({ status: "empty" });
      },
      onDelete: (targetId) => {
        remaining = remaining.filter((item) => item.primaryKey !== targetId);
        if (targetId === AGENT) {
          gateAfterFirstDelete = new Promise<void>((resolve) => {
            releaseAfterFirstDelete = resolve;
          });
        }
      },
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(AGENT);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
      }, { timeout: 5000 });

      const deleteButton = async () => vi.waitFor(() => {
        const button = [...element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button")]
          .find((candidateButton) => candidateButton.textContent?.trim() === "Delete");
        expect(button).toBeTruthy();
        return button!;
      }, { timeout: 5000 });

      const readsBeforeDelete = route.listReads.length;
      (await deleteButton()).click();
      await vi.waitFor(() => {
        expect(route.listReads.length).toBeGreaterThan(readsBeforeDelete);
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
        expect(route.router.currentRoute.value.query.mode).toBe("list");
      }, { timeout: 5000 });
      // Before the refreshed [B] list arrives, never fall back to any entry from the stale [A, B] list.
      await nextTick();
      await nextTick();
      expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      expect(route.router.currentRoute.value.query.mode).toBe("list");

      releaseAfterFirstDelete();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(OTHER);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
      }, { timeout: 5000 });

      (await deleteButton()).click();
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
        expect(route.router.currentRoute.value.query.mode).toBe("list");
        expect(element.textContent).toContain("Select an agent on the left, or create one.");
      }, { timeout: 5000 });
    } finally {
      releaseAfterFirstDelete();
      app.unmount();
    }
  });

  it("keeps a dirty create form mounted until leaving is confirmed: Keep editing restores create draft and Discard switches to the clicked agent", { timeout: 20000 }, async () => {
    let summaryGate: Promise<void> | null = null;
    let releaseSummary: () => void = () => {};
    const rows = [
      agentRow(AGENT, String(stored.name), String(stored.description)),
      agentRow(OTHER, "Planner", "Plans tasks"),
    ];
    const route = mountBuiltinRoute({
      initialState: { mode: "create" },
      onListRead: () => Response.json({ status: "ready", value: rows }),
      onSummaryRead: async (primaryKey) => {
        if (primaryKey === OTHER && summaryGate) {
          await summaryGate;
        }
        const label = primaryKey === OTHER ? "Planner" : String(stored.name);
        return Response.json({
          status: "ready",
          value: { primaryKey: primaryKey ?? AGENT, label, fields: { description: "Plans tasks", enabled: true } },
        });
      },
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(element.querySelectorAll(".sdk-object-list [role=option]")).toHaveLength(2);
        expect(fieldItem("/name")?.querySelector("input")).toBeTruthy();
      }, { timeout: 5000 });

      const nameInput = fieldItem("/name")!.querySelector<HTMLInputElement>("input")!;
      nameInput.value = "Draft Agent";
      nameInput.dispatchEvent(new Event("input"));
      await nextTick();

      // Delay B's summary read so selectedReady stays false while clicking B from dirty create mode.
      summaryGate = new Promise<void>((resolve) => {
        releaseSummary = resolve;
      });
      const optionB = [...element.querySelectorAll<HTMLElement>(".sdk-object-list [role=option]")]
        .find((optionEl) => optionEl.textContent?.includes("Planner"))!;
      optionB.click();

      // Form must remain mounted (not unmounted while summary is pending) and show unsaved leave confirmation.
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Draft Agent");
      await answerLeaveConfirm("keep");

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.mode).toBe("create");
        expect(route.router.currentRoute.value.query.selected).toBeUndefined();
      }, { timeout: 5000 });
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Draft Agent");

      // Click B again and discard the unsaved draft -> loads B cleanly once summary resolves.
      optionB.click();
      await answerLeaveConfirm("discard");
      releaseSummary();
      summaryGate = null;

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(OTHER);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
        expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Planner");
      }, { timeout: 5000 });
    } finally {
      releaseSummary();
      app.unmount();
    }
  });

  it("keeps a dirty edit form mounted when switching to a missing or forbidden target until confirmed: Keep editing returns to A and Discard unmounts the form with error in place", { timeout: 20000 }, async () => {
    const missingId = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a99";
    const rows = [
      agentRow(AGENT, String(stored.name), String(stored.description)),
      agentRow(missingId, "Ghost Agent", "Deleted elsewhere"),
    ];
    const route = mountBuiltinRoute({
      onListRead: () => Response.json({ status: "ready", value: rows }),
      onSummaryRead: (primaryKey) => primaryKey === missingId
        ? Response.json({ status: "error", message: "Agent definition not found" })
        : Response.json({
          status: "ready",
          value: { primaryKey: AGENT, label: String(stored.name), fields: { description: String(stored.description), enabled: true } },
        }),
    });
    const { app, element } = await route.open();
    try {
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(AGENT);
        expect(fieldItem("/name")?.querySelector("input")?.value).toBe("e2e-agent-settings");
      }, { timeout: 5000 });

      const nameInput = fieldItem("/name")!.querySelector<HTMLInputElement>("input")!;
      nameInput.value = "Unsaved A Edit";
      nameInput.dispatchEvent(new Event("input"));
      await nextTick();

      const optionC = [...element.querySelectorAll<HTMLElement>(".sdk-object-list [role=option]")]
        .find((optionEl) => optionEl.textContent?.includes("Ghost Agent"))!;
      optionC.click();

      // Wait for C's error summary while the confirm dialog is still open: form stays mounted, Delete stays hidden.
      await vi.waitFor(() => {
        expect(element.textContent).toContain("Agent definition not found");
      }, { timeout: 5000 });
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Unsaved A Edit");
      const deleteButtonsWhileConfirming = [...element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button")]
        .filter((button) => button.textContent?.trim() === "Delete");
      expect(deleteButtonsWhileConfirming).toHaveLength(0);

      await answerLeaveConfirm("keep");
      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(AGENT);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
      }, { timeout: 5000 });
      expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Unsaved A Edit");

      // Switch to C again and discard -> form unmounts cleanly and C's error stays visible in place.
      optionC.click();
      await answerLeaveConfirm("discard");

      await vi.waitFor(() => {
        expect(route.router.currentRoute.value.query.selected).toBe(missingId);
        expect(route.router.currentRoute.value.query.mode).toBe("edit");
        expect(fieldItem("/name")).toBeNull();
        expect(element.textContent).toContain("Agent definition not found");
      }, { timeout: 5000 });
      const deleteButtonsAfterDiscard = [...element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button")]
        .filter((button) => button.textContent?.trim() === "Delete");
      expect(deleteButtonsAfterDiscard).toHaveLength(0);
    } finally {
      app.unmount();
    }
  });

  it("keeps an explicit missing or forbidden deep-linked selection in place without falling back to another agent", { timeout: 20000 }, async () => {
    const missingId = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a99";
    const missingRoute = mountBuiltinRoute({
      initialState: { selected: { className: AGENT_DEFINITION, primaryKey: missingId } },
      onListRead: () => Response.json({ status: "ready", value: [agentRow(OTHER, "Planner", "Plans tasks")] }),
      onSummaryRead: (primaryKey) => primaryKey === missingId
        ? Response.json({ status: "error", message: "Agent definition not found" })
        : Response.json({
          status: "ready",
          value: { primaryKey: OTHER, label: "Planner", fields: { description: "Plans tasks", enabled: true } },
        }),
    });
    const missingPage = await missingRoute.open();
    try {
      await vi.waitFor(() => {
        expect(missingPage.element.querySelectorAll(".sdk-object-list [role=option]")).toHaveLength(1);
        expect(missingPage.element.textContent).toContain("Agent definition not found");
      }, { timeout: 5000 });
      expect(missingRoute.router.currentRoute.value.query.selected).toBe(missingId);
      expect(missingRoute.router.currentRoute.value.query.mode).toBe("edit");
      expect(fieldItem("/name")).toBeNull();
      const deleteButtons = [...missingPage.element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button")]
        .filter((button) => button.textContent?.trim() === "Delete");
      expect(deleteButtons).toHaveLength(0);
    } finally {
      missingPage.app.unmount();
    }

    const forbiddenRoute = mountBuiltinRoute({
      initialState: { selected: { className: AGENT_DEFINITION, primaryKey: missingId } },
      onListRead: () => Response.json({ status: "ready", value: [agentRow(OTHER, "Planner", "Plans tasks")] }),
      onSummaryRead: () => Response.json({ status: "forbidden" }),
    });
    const forbiddenPage = await forbiddenRoute.open();
    try {
      await vi.waitFor(() => {
        expect(forbiddenPage.element.querySelectorAll(".sdk-object-list [role=option]")).toHaveLength(1);
        expect(forbiddenPage.element.querySelector(".agent-settings-summary")?.textContent?.trim()).toBeTruthy();
      }, { timeout: 5000 });
      expect(forbiddenRoute.router.currentRoute.value.query.selected).toBe(missingId);
      expect(forbiddenRoute.router.currentRoute.value.query.mode).toBe("edit");
      expect(fieldItem("/name")).toBeNull();
      const deleteButtons = [...forbiddenPage.element.querySelectorAll<HTMLButtonElement>(".agent-settings-actions button")]
        .filter((button) => button.textContent?.trim() === "Delete");
      expect(deleteButtons).toHaveLength(0);
    } finally {
      forbiddenPage.app.unmount();
    }
  });
});
