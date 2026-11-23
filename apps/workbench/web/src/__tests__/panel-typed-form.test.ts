import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SKILL } from "@ontomato/contracts/panel-client-requests";
import { PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { confirmDiscard, formSaveCalls, humanIntents, ignoreChanges,
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * The agent settings' form as G1 needs it, through the platform's real bridge and admission: the owner describes the
 * form (nested values, arrays, `false`, `null`, a read-only field with its reason, defaults for a new agent), a skill
 * picker and a data scope graph edit two of its fields through field ports, and the save sends the owner's own JSON. The
 * adapters are registered the way the resource modules are, with the frame's own request path, so every request below
 * passed the frame's admission.
 *
 * The mistakes these catch: a value turned into text on its way to the owner; a field projection that keeps a second
 * draft (one dirty fact, one save); a field rule written into the SDK instead of read from the owner; a create that does
 * not move the panel onto the object the owner created; and a draft accepted before the owner has checked it whole.
 */

const sql = { namespace: { kind: "domain", domainId: "domain-1" }, name: "sql" };
const chart = { namespace: { kind: "domain", domainId: "domain-1" }, name: "chart" };
const stored: PanelFormValues = {
  name: "Analyst", description: "", icon: null, enabled: false, systemPrompt: "Be brief",
  modelSelection: { modelId: "openai/gpt-4o" }, skills: [sql], classNames: ["Order"],
  enabledMcpServiceIds: [], executionUserId: "user-1",
};
const defaults: PanelFormValues = {
  name: "", description: "", icon: null, enabled: true, systemPrompt: "",
  modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], executionUserId: null,
};
const reference = (objectType: string, multiple: boolean) => ({ kind: "reference" as const, objectType, multiple });
const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"], more = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });
const fields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }, { required: true }),
  field("/enabled", "Enabled", { kind: "switch" }),
  field("/systemPrompt", "Instructions", { kind: "markdown" }),
  field("/modelSelection/modelId", "Model", reference(MODEL_OPTION, false)),
  field("/skills", "Skills", reference(SKILL, true)),
  field("/classNames", "Data scope", reference(OBJECT_TYPE, true), { help: "Nothing chosen keeps the default scope" }),
  field("/executionUserId", "Runs as", reference("platform:User", false),
    { readOnly: true, readOnlyReason: "Only a domain governance administrator changes it" }),
  field("/icon", "Avatar", { kind: "hidden" }),
];
const AGENT = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const CREATED = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a09";
const revision = 7;
const save = (operation: string) => ({ method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: operation });

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};
const projection = (
  id: string,
  fields: Pick<Exclude<ProductProjection, { componentId: "@ontomato/sdk:MetricChart" }>, "componentId" | "inputs" | "data" | "operations">,
  config: ProductProjection["config"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", outputs: {}, config, ...fields,
});
const formInputs = {
  agent: { kind: "object", objectType: AGENT_DEFINITION },
  values: { kind: "json" },
  changedField: { kind: "scalar", type: "string" },
} as const;
const formParams = { values: { input: "values" }, changedField: { input: "changedField" } };
const referencePicker = (id: string, objectType: string) => {
  const source = { type: { kind: "PlatformObjectType" as const, id: objectType } };
  return projection(id, {
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { values: { kind: "json" } },
    data: {
      options: { source, read: "options", params: {} },
      selected: { source, read: "resolve", params: { values: { input: "values" } } },
    },
  });
};
const projections: Record<string, ProductProjection> = {
  "agent-definition-form": projection("agent-definition-form", {
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: formInputs,
    data: {
      form: { source: { object: { input: "agent" } }, read: "form", params: formParams },
      createForm: { source: { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } }, read: "createForm", params: formParams },
    },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
  }),
  "agent-skill-choice": referencePicker("agent-skill-choice", SKILL),
  "agent-model-choice": referencePicker("agent-model-choice", MODEL_OPTION),
  "agent-data-scope": projection("agent-data-scope", {
    componentId: "@ontomato/sdk:ObjectGraph",
    inputs: {},
    data: {
      nodes: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} },
      edges: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} },
    },
  }, { edgeEnds: { source: "/fromclass", target: "/toclass" } }),
};
const manifest = definePanel({
  state: { selectedAgent: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true } },
  members: {
    definition: { target: { projectionId: "agent-definition-form" }, inputs: { agent: { state: "selectedAgent" } } },
    skills: { target: { projectionId: "agent-skill-choice" }, inputs: {}, formField: { slot: "definition", path: "/skills" } },
    model: { target: { projectionId: "agent-model-choice" }, inputs: {}, formField: { slot: "definition", path: "/modelSelection/modelId" } },
    scope: { target: { projectionId: "agent-data-scope" }, inputs: {}, formField: { slot: "definition", path: "/classNames" } },
  },
});
const panel = panelRecord("panel-agent-settings", "Agent settings", manifest);
const use = panelUse("use-agent-settings", "agent-settings", panel.id, "/ontology/agents");

/** A definition as the definitions service returns it. */
const definition = (id: string, values: PanelFormValues) => ({ id, sortOrder: 0, ...values });

/** The owner, as the definitions service, the skill catalogue and the metadata read answer. */
function owner(request: Sent, valuesById: ReadonlyMap<string, PanelFormValues>): Response | undefined {
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/assistant/agent-definitions/form") {
    const { target, values, changedField } = request.body as {
      target: { kind: "draft" } | { kind: "object"; primaryKey: string };
      values?: PanelFormValues;
      changedField: string | null;
    };
    const create = target.kind === "draft";
    const base = create ? defaults : valuesById.get(target.primaryKey)!;
    if (values && changedField === null && values.executionUserId !== base.executionUserId)
      return Response.json({ error: { message: "You may not change who the agent runs as" }, details: { fields: [
        { field: "/executionUserId", code: "target_unavailable", message: "Only a domain governance administrator changes it" },
      ] } }, { status: 422 });
    const shown = values ? { ...values, name: String(values.name).trim() } : base;
    return Response.json({ fields, values: shown, revision, errors: [], save: save(create ? "agent.create" : "agent.update") });
  }
  const agent = /^\/api\/assistant\/agent-definitions\/([^/]+)$/.exec(request.path);
  if (agent && request.method === "GET") return Response.json(definition(agent[1]!, valuesById.get(agent[1]!)!));
  if (request.path === "/api/assistant/agent-skills")
    return Response.json({ skills: [{ skill: sql, title: "SQL", description: "" }, { skill: chart, title: "Charts", description: "" }] });
  if (request.path === "/api/data-query/model-options")
    return Response.json({ data: {
      models: [{ ref: "openai/gpt-4o", name: "GPT-4o", type: "chat" }, { ref: "openai/gpt-4o-mini", name: "GPT-4o mini", type: "chat" }],
      defaultModelId: "openai/gpt-4o-mini", embeddingModelId: null,
    } });
  if (request.path === "/api/data-query/admin/getMetas")
    return Response.json({ success: true, data: {
      classDef: [{ className: "Order", showName: "Orders" }, { className: "Customer", showName: "Customers" }, { className: "Invoice", showName: "Invoices" }],
      relationship_rule: { "rel-1": { fromclass: "Order", toclass: "Customer" } },
    } });
  return undefined;
}

function ownerForInstance() {
  const valuesById = new Map([[AGENT, stored]]);
  const intents = humanIntents((_, { target, input }) => {
    const primaryKey = target?.kind === "object" ? target.primaryKey : CREATED;
    valuesById.set(primaryKey, (input as PanelFormSaveInput).values);
    return {
      kind: "success", data: {},
      affected: { objects: [{ objectType: AGENT_DEFINITION, primaryKey }], objectTypes: [AGENT_DEFINITION] },
    };
  }, { source: "input", input: "agent" }, { creates: true });
  return (request: Sent) => intents(request) ?? owner(request, valuesById);
}

const formMembers = ["definition", "skills", "model"];

async function open(
  address: string,
  state: Record<string, unknown>,
  { showScope = false, override }: { showScope?: boolean; override?: (request: Sent) => Response | undefined } = {},
) {
  const answer = ownerForInstance();
  const sent = installPlatform((request) => override?.(request) ?? answer(request) ?? nothingAt(request));
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), address, state as never);
  inside(frame);
  const failed: string[] = [];
  window.addEventListener("message", (event) => {
    if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "failed") failed.push(event.data.message);
  });
  const mounted = await mountPanel(panelOf(...formMembers, ...(showScope ? ["scope"] : [])));
  return { ...mounted, sent, failed };
}

const fieldItem = (path: string) => document.querySelector(`#app [data-field="${path}"]`);
const node = (id: string) => document.querySelector<SVGGElement>(`#app [data-node-id="${id}"]`)!;

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("edits the owner's JSON through one form, with the skill picker and the data scope as its fields", async () => {
  const { context, sent } = await open("/ontology/agents", {
    selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT },
  }, { showScope: true });
  await vi.waitFor(() => {
    expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst");
    expect(node("Customer")).toBeTruthy();
    // The picker resolves the held skills by its own read, independent of the form's.
    expect(fieldItem("/skills")?.textContent).toContain("SQL");
  }, { timeout: 5000 });
  // The owner's own rules: false stays false, a read-only field says why, a hidden one is not drawn. A reference no
  // member of this panel draws is named and says it cannot be edited here; the avatar is chosen in the form.
  expect(fieldItem("/enabled")?.querySelector(".el-switch")?.classList.contains("is-checked")).toBe(false);
  expect(fieldItem("/executionUserId")?.textContent).toContain("This field cannot be edited here yet");
  expect(fieldItem("/executionUserId")?.textContent).toContain("Only a domain governance administrator changes it");
  expect(fieldItem("/icon")?.querySelector(".sdk-form-avatar")).not.toBeNull();
  expect(fieldItem("/classNames")?.textContent).toContain("Nothing chosen keeps the default scope");
  // The data scope: the chosen class, and the one a drawn relationship joins it to, marked.
  expect(node("Order").classList.contains("selected")).toBe(true);
  expect(node("Customer").classList.contains("accent")).toBe(true);
  expect(context.instance.dirty()).toBe(false);
  // Classes and relationships came from one metadata read.
  expect(sent.filter((request) => request.path === "/api/data-query/admin/getMetas")).toHaveLength(1);

  node("Invoice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(node("Invoice").classList.contains("selected")).toBe(true));
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-object-graph-adjacent")][0]!.click();
  await vi.waitFor(() => expect(node("Customer").classList.contains("selected")).toBe(true));
  // One form, one dirty fact: the graph's edits are the form's.
  expect(context.instance.dirty()).toBe(true);
  expect(fieldItem("/classNames")?.classList.contains("sdk-object-graph-changed")).toBe(false);

  await context.instance.invoke("definition.save");
  expect(formSaveCalls(sent)).toEqual([{
    target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: AGENT },
    input: { values: { ...stored, classNames: ["Order", "Invoice", "Customer"] }, revision, submittedFields: ["/classNames"] },
  }]);
  await vi.waitFor(() => expect(context.instance.dirty()).toBe(false));
  // Every request went through the frame's admission as the reader's own.
  expect(sent.every((request) => request.credential !== null)).toBe(true);
});

it("creates with the owner's defaults, and moves the panel onto the agent the owner created", async () => {
  const { context, sent } = await open("/ontology/agents", {});
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")).toBeTruthy(), { timeout: 5000 });
  expect(sent.find((request) => request.path === "/api/assistant/agent-definitions/form")?.body)
    .toEqual({ target: { kind: "draft" }, changedField: null });
  expect(fieldItem("/enabled")?.querySelector(".el-switch")?.classList.contains("is-checked")).toBe(true);
  const input = fieldItem("/name")!.querySelector("input")!;
  input.value = "Planner";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(formSaveCalls(sent)).toEqual([{
    target: { kind: "draft" },
    input: { values: { ...defaults, name: "Planner" }, revision, submittedFields: ["/name"] },
  }]);
  await vi.waitFor(() => expect(context.instance.state.values.value.selectedAgent).toEqual({ className: AGENT_DEFINITION, primaryKey: CREATED }));
});

/** The panel opened at a link to a draft the agent wrote for it, the agent selected. */
/** The draft the agent wrote, as its link names it. */
const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/agent.page-draft.json" };
const draftAt = `/api/assistant/sessions/${link.sessionId}/runs/${link.runId}/page-draft`;

async function openWithDraft(form: PanelFormValues, envelope: { operation: string; target: { objectType: string; id?: string }; created?: { id: string } } = { operation: "agent.update", target: { objectType: AGENT_DEFINITION, id: AGENT } }) {
  const query = new URLSearchParams({ draftSessionId: link.sessionId, draftRunId: link.runId, draftPath: link.path });
  const draft = { pageKey: use.pageKey, ...envelope, form };
  const answer = ownerForInstance();
  const sent = installPlatform((request) => {
    if (request.path === draftAt) return Response.json(draft);
    if (request.path === `${draftAt}/created`) return new Response(null, { status: 204 });
    return answer(request) ?? nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), `/ontology/agents?${query}`, { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  inside(frame);
  const failed: string[] = [];
  const settled: unknown[] = [];
  window.addEventListener("message", (event) => {
    if (event.data?.channel !== PANEL_HOST_CHANNEL) return;
    if (event.data.kind === "failed") failed.push(event.data.message);
    if (event.data.kind === "draft-settled") settled.push(event.data.draft);
  });
  return { ...(await mountPanel(panelOf(...formMembers))), failed, settled, sent, draft };
}

// The owner refusing the draft is the form's to say (panelisation lead, 2026-11-21): on the form, the panel going on.
it("refuses a draft the owner refuses, whole, naming the reason on the form, and marks nothing", async () => {
  const { context, failed, sent, draft } = await openWithDraft({ ...stored, executionUserId: "user-2" });
  // Its reason is the field's: said there, and counted below the form.
  await vi.waitFor(() => expect(document.querySelector("#app .sdk-owner-form-refusal")?.textContent?.trim()).toBe("1 field needs changing"), { timeout: 5000 });
  expect(document.querySelector('#app [data-field="/executionUserId"]')?.textContent).toContain("Only a domain governance administrator changes it");
  expect(failed).toEqual([]);
  // The whole draft went to the owner for its check, as the agent wrote it.
  expect(sent.find((request) => (request.body as { values?: unknown } | null)?.values)?.body)
    .toEqual({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: AGENT }, values: draft.form, changedField: null });
  expect(context.draft.value).toBeNull();
  expect(context.instance.dirty()).toBe(false);
  expect(formSaveCalls(sent)).toEqual([]);
});

it("shows a draft the owner accepts in the form and its field projections, marked and unsaved", async () => {
  const { context, sent } = await openWithDraft({ ...stored, name: "  Analyst v2 ", skills: [sql, chart] });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name", "/skills"])), { timeout: 5000 });
  await vi.waitFor(() => expect(fieldItem("/skills")?.textContent).toContain("Charts"));
  // The owner's normalised value is what the form holds; the picker's field is the same form's, marked with it.
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst v2");
  expect(fieldItem("/skills")?.classList.contains("sdk-reference-picker-changed")).toBe(true);
  expect(fieldItem("/name")?.classList.contains("sdk-owner-form-field-changed")).toBe(true);
  // The changed fields are named in words too, by the owner's labels, not by colour alone.
  expect(document.querySelector("#app .sdk-owner-form-changed")?.textContent?.trim()).toBe("Changed: Name, Skills");
  expect(context.instance.dirty()).toBe(true);
  expect(formSaveCalls(sent)).toEqual([]);
});

it("opens a draft that changes nothing as the agent is, with nothing unsaved", async () => {
  const { context, failed, sent } = await openWithDraft(stored);
  // The owner checked the draft, and the form shows the agent as it is.
  await vi.waitFor(() => expect(sent.some((request) => (request.body as { values?: unknown } | null)?.values)).toBe(true), { timeout: 5000 });
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst"));
  await nextTick();
  expect(context.draft.value).toBeNull();
  expect(context.instance.dirty()).toBe(false);
  expect(failed).toEqual([]);
});

it("reopens a saved create draft on the agent it created, and creates nothing again", async () => {
  const { context, sent } = await openWithDraft(stored, { operation: "agent.create", target: { objectType: AGENT_DEFINITION }, created: { id: AGENT } });
  // The owner checked the draft against the agent it created.
  await vi.waitFor(() => expect(sent.some((request) => (request.body as { values?: unknown } | null)?.values)).toBe(true), { timeout: 5000 });
  await vi.waitFor(() => expect(context.instance.state.values.value.selectedAgent).toEqual({ className: AGENT_DEFINITION, primaryKey: AGENT }));
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst"));
  // The draft was compared with the agent it created, not offered as a new one.
  expect(sent.filter((request) => (request.body as { values?: unknown } | null)?.values).map((request) => request.body))
    .toEqual([{ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: AGENT }, values: stored, changedField: null }]);
  expect(context.draft.value).toBeNull();
  expect(context.instance.dirty()).toBe(false);
  expect(formSaveCalls(sent)).toEqual([]);
});

it("shows a localized reason for a stored skill no longer in the catalogue", async () => {
  const { context } = await open("/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } },
    { override: (request) => request.path === "/api/assistant/agent-skills" ? Response.json({ skills: [] }) : undefined });
  await vi.waitFor(() => expect(fieldItem("/skills")?.textContent).toContain("sql"), { timeout: 5000 });
  fieldItem("/skills")!.querySelector(".el-select__wrapper")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector('.el-select-dropdown__item[title="Unavailable"]')?.textContent).toContain("sql");
  });
  expect(context.instance.dirty()).toBe(false);
});

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")].find((item) => item.textContent?.trim() === label)!;

it("tells the host the draft is settled once the reader saved it, naming the draft that ended", async () => {
  const { context, settled, sent } = await openWithDraft({ ...stored, name: "Analyst v2" });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name"])), { timeout: 5000 });
  expect(settled).toEqual([]);
  await context.instance.invoke("definition.save");
  await vi.waitFor(() => expect(settled).toEqual([link]));
  expect(formSaveCalls(sent)).toHaveLength(1);
  // An update draft has nothing to record: its object already existed.
  expect(sent.some((request) => request.path === `${draftAt}/created`)).toBe(false);
  expect(context.draft.value).toBeNull();
});

it("tells the host the draft is settled once the reader discarded it, and writes nothing", async () => {
  const { context, settled, sent } = await openWithDraft({ ...stored, name: "Analyst v2" });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name"])), { timeout: 5000 });
  button("Discard").click();
  await confirmDiscard();
  await vi.waitFor(() => expect(settled).toEqual([link]));
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst");
  expect(context.instance.dirty()).toBe(false);
  expect(formSaveCalls(sent)).toEqual([]);
  expect(sent.some((request) => request.path === `${draftAt}/created`)).toBe(false);
});

it("records what a saved create draft created before it tells the host the draft is settled", async () => {
  const { context, settled, sent } = await openWithDraft({ ...defaults, name: "Planner" }, { operation: "agent.create", target: { objectType: AGENT_DEFINITION } });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name"])), { timeout: 5000 });
  expect(context.instance.state.values.value.selectedAgent).toBeNull();
  await context.instance.invoke("definition.save");
  await vi.waitFor(() => expect(settled).toEqual([link]));
  const created = sent.findIndex((request) => request.path === `${draftAt}/created`);
  expect(sent[created]?.body).toEqual({ path: link.path, id: CREATED });
  const dispatched = sent.findIndex((request) => request.method === "POST" && request.path.endsWith("/dispatch"));
  expect(dispatched).toBeGreaterThanOrEqual(0);
  expect(created).toBeGreaterThan(dispatched);
});

/** Clears a picker as a reader does: hover it, then its clear icon. */
async function clearPicker(path: string) {
  const select = fieldItem(path)!.querySelector<HTMLElement>(".el-select")!;
  select.dispatchEvent(new MouseEvent("mouseenter"));
  await nextTick();
  const clear = select.querySelector<HTMLElement>(".el-select__clear");
  expect(clear).not.toBeNull();
  clear!.click();
  await nextTick();
}

it("clears a single reference to the owner's null and a multiple one to an empty list, and saves them so", async () => {
  const { context, sent, failed } = await open("/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  await vi.waitFor(() => {
    expect(fieldItem("/modelSelection/modelId")?.textContent).toContain("GPT-4o");
    expect(fieldItem("/skills")?.textContent).toContain("SQL");
  }, { timeout: 5000 });

  // The one explicit model cleared: the agent follows the domain's default again, which the owner writes as null.
  await clearPicker("/modelSelection/modelId");
  await clearPicker("/skills");
  await vi.waitFor(() => expect(context.instance.dirty()).toBe(true));

  await context.instance.invoke("definition.save");
  expect(formSaveCalls(sent)).toEqual([{
    target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: AGENT },
    input: {
      values: { ...stored, modelSelection: { modelId: null }, skills: [] },
      revision,
      submittedFields: ["/modelSelection/modelId", "/skills"],
    },
  }]);
  // A frame's report reaches the host a task later; none came, and the frame is still there.
  await new Promise((resolve) => setTimeout(resolve));
  expect(failed).toEqual([]);
});
