import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SKILL } from "@ontomato/contracts/panel-client-requests";
import { PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { confirmDiscard, formSaveCalls, humanIntents, ignoreChanges,
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, panelWithSlots, registered, writePanelDocument, type Sent,
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
  modelSelection: { modelId: "gpt-4o" }, skills: [sql], classNames: ["Order"],
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
const save = { method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {} };

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
    skills: { target: { projectionId: "agent-skill-choice" }, inputs: {} },
    model: { target: { projectionId: "agent-model-choice" }, inputs: {} },
    scope: { target: { projectionId: "agent-data-scope" }, inputs: {} },
  },
});
const panel = panelRecord("panel-agent-settings", "Agent settings", manifest, {
  definition: {
    "field-skills": "skills",
    "field-modelSelection.modelId": "model",
    "field-classNames": "scope",
  },
});
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
    return Response.json({ fields, values: shown, revision, errors: [], save });
  }
  const agent = /^\/api\/assistant\/agent-definitions\/([^/]+)$/.exec(request.path);
  if (agent && request.method === "GET") return Response.json(definition(agent[1]!, valuesById.get(agent[1]!)!));
  if (request.path === "/api/assistant/agent-skills")
    return Response.json({ skills: [{ skill: sql, title: "SQL", description: "" }, { skill: chart, title: "Charts", description: "" }] });
  if (request.path === "/api/data-query/model-options")
    return Response.json({ data: {
      models: [{ name: "gpt-4o", type: "chat" }, { name: "gpt-4o-mini", type: "chat" }],
      defaultModel: "gpt-4o-mini", embeddingModel: null,
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
  const mounted = await mountPanel(panelWithSlots(["definition"], {
    definition: {
      "field-skills": "skills",
      "field-modelSelection.modelId": "model",
      ...(showScope ? { "field-classNames": "scope" } : {}),
    },
  }));
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

/** The form's action button by label. */
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")].find((item) => item.textContent?.trim() === label)!;

it("rejects read-only fields on live fillForm and leaves the form clean", async () => {
  const { context, failed, sent } = await open("/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst"), { timeout: 5000 });
  const outcome = await context.instance.fillForm({
    member: "definition",
    values: { "/executionUserId": "user-2" },
  });
  expect(outcome).toMatchObject({
    ok: false,
    reason: "all_fields_rejected",
    member: "definition",
    rejectedFields: [{
      path: "/executionUserId",
      reason: "read_only",
      message: "Only a domain governance administrator changes it",
    }],
  });
  expect(failed).toEqual([]);
  expect(context.instance.dirty()).toBe(false);
  expect(formSaveCalls(sent)).toEqual([]);
});

it("fills editable fields live in the form and its field projections, marked and unsaved, and enforces overwriteUnsaved", async () => {
  const { context, sent } = await open("/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst"), { timeout: 5000 });

  const filled = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v2", "/skills": [sql, chart] },
  });
  expect(filled).toMatchObject({ ok: true, member: "definition", filledFields: ["/name", "/skills"] });
  await vi.waitFor(() => expect(fieldItem("/skills")?.textContent).toContain("Charts"));
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst v2");
  expect(fieldItem("/skills")?.classList.contains("sdk-reference-picker-changed")).toBe(true);
  expect(fieldItem("/name")?.classList.contains("sdk-owner-form-field-changed")).toBe(true);
  // The changed fields are named in words too, by the owner's labels, not by colour alone.
  expect(document.querySelector("#app .sdk-owner-form-changed")?.textContent?.trim()).toBe("Changed: Name, Skills");
  expect(context.instance.dirty()).toBe(true);
  expect(formSaveCalls(sent)).toEqual([]);

  // Agent refining its own previously filled field merges cleanly without blocked_unsaved.
  const refined = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v2b" },
  });
  expect(refined).toMatchObject({ ok: true, member: "definition", filledFields: ["/name"] });
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst v2b");

  // A manual user edit on a field blocks agent overwrite on that field unless overwriteUnsaved is explicitly true.
  const nameInput = fieldItem("/name")!.querySelector("input")!;
  nameInput.value = "Analyst user edit";
  nameInput.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst user edit"));

  const blocked = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v3" },
  });
  expect(blocked).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "definition" });
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst user edit");

  const overwritten = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v3" },
    overwriteUnsaved: true,
  });
  expect(overwritten).toMatchObject({ ok: true, member: "definition", filledFields: ["/name"] });
  await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst v3"));

  // Discarding restores the owner's baseline and writes nothing.
  button("Discard").click();
  await confirmDiscard();
  await vi.waitFor(() => expect(context.instance.dirty()).toBe(false));
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst");
  expect(document.querySelector("#app .sdk-owner-form-changed")).toBeNull();
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
    expect(fieldItem("/modelSelection/modelId")?.textContent).toContain("gpt-4o");
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
