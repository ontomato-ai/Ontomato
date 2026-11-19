import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, OBJECT_TYPE, RELATIONSHIP, SKILL } from "@ontomato/contracts/panel-client-requests";
import { PANEL_HOST_CHANNEL } from "@ontomato/contracts/panel-host";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, writePanelDocument, type Sent,
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

const stored: PanelFormValues = {
  name: "Analyst", description: "", icon: null, enabled: false, systemPrompt: "Be brief",
  modelSelection: { modelId: null }, skills: [{ name: "sql", source: "domain" }], classNames: ["Order"],
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
  field("/modelSelection/modelId", "Model", { kind: "select", options: [
    { value: "openai/gpt", label: "GPT", description: null, disabled: false, disabledReason: null },
  ] }),
  field("/skills", "Skills", reference(SKILL, true)),
  field("/classNames", "Data scope", reference(OBJECT_TYPE, true), { help: "Nothing chosen keeps the default scope" }),
  field("/executionUserId", "Runs as", reference("platform:User", false),
    { readOnly: true, readOnlyReason: "Only a domain governance administrator changes it" }),
  field("/icon", "Avatar", { kind: "hidden" }),
];
const save = (operation: string) => ({ method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: operation });

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};
const projection = (id: string, componentId: string, binding: string, more: Partial<ProductProjection> = {}): ProductProjection => ({
  ...current, id, name: id, description: "", componentId, binding: { kind: "PlatformObjectType", id: binding },
  inputs: {}, display: {}, ...more,
});
const projections: Record<string, ProductProjection> = {
  "agent-definition-form": projection("agent-definition-form", "ObjectForm", AGENT_DEFINITION, {
    inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION } }, display: { creates: true },
  }),
  "agent-skill-choice": projection("agent-skill-choice", "ReferencePicker", SKILL),
  "agent-data-scope": projection("agent-data-scope", "ObjectGraph", OBJECT_TYPE, {
    graph: { edges: { binding: { kind: "PlatformObjectType", id: RELATIONSHIP }, sourcePath: "/fromclass", targetPath: "/toclass" } },
  }),
};
const manifest = definePanel({
  state: { selectedAgent: { kind: "object", objectType: AGENT_DEFINITION, deepLink: true } },
  slots: {
    definition: { projectionId: "agent-definition-form", inputs: { agent: { state: "selectedAgent" } } },
    skills: { projectionId: "agent-skill-choice", inputs: {}, formField: { slot: "definition", path: "/skills" } },
    scope: { projectionId: "agent-data-scope", inputs: {}, formField: { slot: "definition", path: "/classNames" } },
  },
  operations: [],
});
const panel = panelRecord("panel-agent-settings", "Agent settings", manifest);
const use = panelUse("use-agent-settings", "agent-settings", panel.id, "/ontology/agents");

/** The owner, as the definitions service answers: a form for a target, a whole-draft check, and the saves. */
function owner(request: Sent): Response | undefined {
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/assistant/agent-definitions/form") {
    const { target, values, changedField } = request.body as { target: { kind: string }; values?: PanelFormValues; changedField: string | null };
    const create = target.kind === "draft";
    const base = create ? defaults : stored;
    if (values && changedField === null && values.executionUserId !== base.executionUserId)
      return Response.json({ error: { message: "You may not change who the agent runs as", fields: [
        { field: "/executionUserId", code: "target_unavailable", message: "Only a domain governance administrator changes it" },
      ] } }, { status: 422 });
    const shown = values ? { ...values, name: String(values.name).trim() } : base;
    return Response.json({ fields, values: shown, save: save(create ? "agent.create" : "agent.update") });
  }
  if (request.path === "/api/assistant/agent-definitions/0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01" && request.method === "GET")
    return Response.json({ id: "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01", name: "Analyst" });
  if (request.path === "/api/assistant/agent-definitions/0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01" && request.method === "PUT")
    return Response.json({ id: "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01", name: (request.body as PanelFormValues).name });
  if (request.path === "/api/assistant/agent-definitions" && request.method === "POST")
    return Response.json({ id: "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a09", name: (request.body as PanelFormValues).name });
  if (request.path === "/api/assistant/agent-skills")
    return Response.json({ skills: [{ name: "sql", source: "domain", title: "SQL" }, { name: "chart", source: "domain", title: "Charts" }] });
  if (request.path === "/api/data-query/admin/getMetas")
    return Response.json({ data: {
      classDef: [{ className: "Order", showName: "Orders" }, { className: "Customer", showName: "Customers" }, { className: "Invoice", showName: "Invoices" }],
      relationship_rule: [{ id: "rel-1", fromclass: "Order", toclass: "Customer" }],
    } });
  return undefined;
}

/** The test's resource adapters, written against the SDK's adapter interface as the resource modules are. */
async function registerAdapters() {
  const { platformObjectAdapters } = await import("../../../../../packages/apps-sdk/src/resources");
  const { PlatformObjectRefusal } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  type Factory = (typeof platformObjectAdapters)[number];
  const read = async (response: Promise<Response>) => {
    const answer = await response;
    const body = await answer.json();
    if (!answer.ok)
      throw new PlatformObjectRefusal(body.error.message,
        Object.fromEntries((body.error.fields ?? []).map((item: { field: string; message: string }) => [item.field, item.message])));
    return body;
  };
  const post = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const factories: Factory[] = [
    ({ request }) => [{
      objectType: AGENT_DEFINITION,
      read: async (id) => ({ primaryKey: id, label: (await read(request(`/assistant/agent-definitions/${id}`, {}, ""))).name, fields: {} }),
      forms: {
        describe: (form) => read(request("/assistant/agent-definitions/form", post(form), "")),
        async save(target, { values }) {
          const saved = target.kind === "object"
            ? await read(request(`/assistant/agent-definitions/${target.primaryKey}`, { ...post(values), method: "PUT" }, ""))
            : await read(request("/assistant/agent-definitions", post(values), ""));
          return { primaryKey: saved.id, label: saved.name, fields: {} };
        },
      },
    }],
    ({ request }) => {
      const skills = async () => (await read(request("/assistant/agent-skills", {}, ""))).skills as { name: string; source: string; title: string }[];
      const option = (skill: { name: string; source: string; title: string }) =>
        ({ primaryKey: skill.name, value: { name: skill.name, source: skill.source }, label: skill.title });
      return [{
        objectType: SKILL,
        options: {
          list: async () => ({ options: (await skills()).map(option) }),
          async resolve(values) {
            const known = await skills();
            return values.map((value) => {
              const name = (value as { name: string }).name;
              const found = known.find((skill) => skill.name === name);
              return found ? option(found) : { primaryKey: name, value, label: name, unavailable: { reason: "No longer offered" } };
            });
          },
        },
      }];
    },
    ({ request }) => {
      // Classes and relationships come from one metadata read, shared by both adapters.
      let metas: Promise<{ classDef: { className: string; showName: string }[]; relationship_rule: { id: string; fromclass: string; toclass: string }[] }> | undefined;
      const read2 = () => (metas ??= read(request("/admin/getMetas", post({}), "/data-query")).then((body) => body.data));
      return [
        { objectType: OBJECT_TYPE, list: async () => (await read2()).classDef.map((item) => ({ primaryKey: item.className, label: item.showName, fields: {} })) },
        { objectType: RELATIONSHIP, list: async () => (await read2()).relationship_rule.map((item) =>
          ({ primaryKey: item.id, label: item.id, fields: { fromclass: item.fromclass, toclass: item.toclass } })) },
      ];
    },
  ];
  (platformObjectAdapters as Factory[]).push(...factories);
}

async function open(address: string, state: Record<string, unknown>) {
  const sent = installPlatform((request) => owner(request) ?? nothingAt(request));
  await registerAdapters();
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology").frame(frame, use, panel);
  writePanelDocument(panel, use, address, state as never);
  inside(frame);
  const failed: string[] = [];
  window.addEventListener("message", (event) => {
    if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "failed") failed.push(event.data.message);
  });
  const mounted = await mountPanel(panelOf("definition", "skills", "scope"));
  return { ...mounted, sent, failed };
}

const fieldItem = (path: string) => document.querySelector(`#app [data-field="${path}"]`);
const node = (id: string) => document.querySelector<SVGGElement>(`#app [data-node-id="${id}"]`)!;

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("edits the owner's JSON through one form, with the skill picker and the data scope as its fields", async () => {
  const { context, sent } = await open("/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01" } });
  await vi.waitFor(() => {
    expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst");
    expect(node("Customer")).toBeTruthy();
  }, { timeout: 5000 });
  // The owner's own rules: false stays false, a read-only field says why, a hidden one is not drawn.
  expect(fieldItem("/enabled")?.querySelector(".el-switch")?.classList.contains("is-checked")).toBe(false);
  expect(fieldItem("/executionUserId")).toBeNull();
  expect(fieldItem("/icon")).toBeNull();
  expect(fieldItem("/skills")?.textContent).toContain("SQL");
  expect(fieldItem("/classNames")?.textContent).toContain("Nothing chosen keeps the default scope");
  // The data scope: the chosen class, and the one a drawn relationship joins it to, marked.
  expect(node("Order").classList.contains("selected")).toBe(true);
  expect(node("Customer").classList.contains("accent")).toBe(true);
  expect(context.instance.dirty()).toBe(false);

  node("Invoice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(node("Invoice").classList.contains("selected")).toBe(true));
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-object-graph-adjacent")][0]!.click();
  await vi.waitFor(() => expect(node("Customer").classList.contains("selected")).toBe(true));
  // One form, one dirty fact: the graph's edits are the form's.
  expect(context.instance.dirty()).toBe(true);
  expect(fieldItem("/classNames")?.classList.contains("sdk-object-graph-changed")).toBe(false);

  await context.instance.invoke("definition.save");
  const put = sent.find((request) => request.method === "PUT")!;
  expect(put.path).toBe("/api/assistant/agent-definitions/0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01");
  // The owner's own value shape: the nested model, the skill reference objects, false and null, nothing as text.
  expect(put.body).toEqual({ ...stored, classNames: ["Order", "Invoice", "Customer"] });
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
  expect(sent.find((request) => request.method === "POST" && request.path === "/api/assistant/agent-definitions")?.body)
    .toEqual({ ...defaults, name: "Planner" });
  await vi.waitFor(() => expect(context.instance.state.values.value.selectedAgent).toEqual({ className: AGENT_DEFINITION, primaryKey: "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a09" }));
});

const AGENT = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";

/** The panel opened at a link to a draft the agent wrote for it, the agent selected. */
async function openWithDraft(form: PanelFormValues) {
  const query = new URLSearchParams({ draftSessionId: "session-1", draftRunId: "run-1", draftPath: "outputs/drafts/agent.page-draft.json" });
  const draft = { pageKey: use.pageKey, operation: "agent.update", target: { id: AGENT }, form };
  const sent = installPlatform((request) =>
    request.path === "/api/assistant/sessions/session-1/runs/run-1/page-draft" ? Response.json(draft) : owner(request) ?? nothingAt(request));
  await registerAdapters();
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology").frame(frame, use, panel);
  writePanelDocument(panel, use, `/ontology/agents?${query}`, { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } });
  inside(frame);
  const failed: string[] = [];
  window.addEventListener("message", (event) => {
    if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "failed") failed.push(event.data.message);
  });
  return { ...(await mountPanel(panelOf("definition", "skills", "scope"))), failed, sent, draft };
}

it("refuses a draft the owner refuses, whole, naming the field and the reason, and marks nothing", async () => {
  const { context, failed, sent, draft } = await openWithDraft({ ...stored, executionUserId: "user-2" });
  await vi.waitFor(() => expect(failed).toEqual(["You may not change who the agent runs as"]), { timeout: 5000 });
  // The whole draft went to the owner for its check, as the agent wrote it.
  expect(sent.find((request) => (request.body as { values?: unknown } | null)?.values)?.body)
    .toEqual({ target: { kind: "object", objectType: AGENT_DEFINITION, primaryKey: AGENT }, values: draft.form, changedField: null });
  expect(context.draft.value).toBeNull();
  expect(context.instance.dirty()).toBe(false);
  expect(sent.some((request) => request.method === "PUT")).toBe(false);
});

it("shows a draft the owner accepts in the form and its field projections, marked and unsaved", async () => {
  const { context, sent } = await openWithDraft({ ...stored, name: "  Analyst v2 ", skills: [...(stored.skills as object[]), { name: "chart", source: "domain" }] });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name", "/skills"])), { timeout: 5000 });
  await vi.waitFor(() => expect(fieldItem("/skills")?.textContent).toContain("Charts"));
  // The owner's normalised value is what the form holds; the picker's field is the same form's, marked with it.
  expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Analyst v2");
  expect(fieldItem("/skills")?.classList.contains("sdk-reference-picker-changed")).toBe(true);
  expect(fieldItem("/name")?.classList.contains("sdk-owner-form-changed")).toBe(true);
  expect(context.instance.dirty()).toBe(true);
  expect(sent.some((request) => request.method === "PUT")).toBe(false);
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
