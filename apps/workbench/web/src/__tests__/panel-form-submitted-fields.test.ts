import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormSaveInput, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, SKILL } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * What the form tells its owner it submitted (`submittedFields`), through the platform's real bridge: the save's input
 * is observed where the form hands it to the owner's adapter, which decides from it whether, for example, an agent's
 * skills are part of the update. A field the reader set counts even when it ends where it began (cleared to an empty
 * list, or set back to the value shown); a field a draft wrote counts; one neither touched is never added.
 *
 * The mistakes these catch: a save that names no fields, so an owner that keeps what was not submitted cannot tell an
 * emptied list from an untouched one; a field counted only when its value differs; a draft's absent field filled in.
 */

const sql = { namespace: { kind: "domain", domainId: "domain-1" }, name: "sql" };
const chart = { namespace: { kind: "domain", domainId: "domain-1" }, name: "chart" };
const stored: PanelFormValues = {
  name: "Analyst", description: "", icon: null, enabled: true, systemPrompt: "",
  modelSelection: { modelId: null }, skills: [sql], classNames: [], enabledMcpServiceIds: [], executionUserId: null,
};
const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"]) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false });
const fields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }),
  field("/description", "Description", { kind: "text" }),
  field("/skills", "Skills", { kind: "reference", objectType: SKILL, multiple: true }),
];
const AGENT = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const save = { method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: "agent.update" };
const record = (id: string, componentId: string, binding: string, more: Partial<ProductProjection> = {}): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId, binding: { kind: "PlatformObjectType", id: binding }, inputs: {}, display: {}, ...more,
});
const projections: Record<string, ProductProjection> = {
  "agent-form": record("agent-form", "ObjectForm", AGENT_DEFINITION, { inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION } } }),
  "agent-skills": record("agent-skills", "ReferencePicker", SKILL),
};
const manifest = definePanel({
  state: { selectedAgent: { kind: "object", objectType: AGENT_DEFINITION, deepLink: true } },
  slots: {
    definition: { projectionId: "agent-form", inputs: { agent: { state: "selectedAgent" } } },
    skills: { projectionId: "agent-skills", inputs: {}, formField: { slot: "definition", path: "/skills" } },
  },
  operations: [],
});
const panel = panelRecord("panel-submitted", "Agents", manifest);
const use = panelUse("use-submitted", "submitted", panel.id, "/ontology/agents");
const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/agent.page-draft.json" };
const draftAt = `/api/assistant/sessions/${link.sessionId}/runs/${link.runId}/page-draft`;

/** The definitions service: a checked draft comes back whole, the fields it did not write as they are stored. */
function owner(request: Sent): Response {
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/assistant/agent-definitions/form") {
    const { values } = request.body as { values?: PanelFormValues };
    return Response.json({ fields, values: { ...stored, ...values }, save });
  }
  if (request.path === `/api/assistant/agent-definitions/${AGENT}` && request.method === "PUT")
    return Response.json({ id: AGENT, sortOrder: 0, ...stored, ...(request.body as PanelFormValues) });
  if (request.path === "/api/assistant/agent-skills")
    return Response.json({ skills: [{ skill: sql, title: "SQL", description: "" }, { skill: chart, title: "Charts", description: "" }] });
  return nothingAt(request);
}

async function open(draft?: PanelFormValues) {
  installPlatform((request) => {
    if (draft && request.path === draftAt) return Response.json({ pageKey: use.pageKey, operation: "agent.update", target: { id: AGENT }, form: draft });
    return owner(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use).frame(frame, registered("ontology", use, panel), true);
  const query = draft ? `?${new URLSearchParams({ draftSessionId: link.sessionId, draftRunId: link.runId, draftPath: link.path })}` : "";
  writePanelDocument(panel, use, `/ontology/agents${query}`, { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } } as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("definition", "skills"));
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#app [data-field="/name"] input')?.value).toBeTruthy(), { timeout: 5000 });
  // The save's input, where the form hands it to the owner's adapter, which still sends the request.
  const { platformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const forms = platformObjectAdapter(AGENT_DEFINITION).forms!;
  const saved = vi.spyOn(forms, "save");
  const submitted = (call: number) => (saved.mock.calls[call]![1] as PanelFormSaveInput).submittedFields;
  return { ...mounted, form: mounted.context.instance.forms.handle("definition")!, submitted };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("names the fields the reader set, an emptied list and a value set back to the one shown included", async () => {
  const { context, form, submitted } = await open();
  const name = document.querySelector<HTMLInputElement>('#app [data-field="/name"] input')!;
  name.value = "Analyst v2";
  name.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  // The skills were not touched: the owner keeps them.
  expect(submitted(0)).toEqual(["/name"]);

  // The skill picker empties the list: an explicit empty list is submitted.
  form.set("/skills", []);
  await context.instance.invoke("definition.save");
  expect(submitted(1)).toEqual(["/skills"]);

  // Set and then set back to what was shown: still the reader's submission.
  form.set("/description", "draft");
  form.set("/description", "");
  await context.instance.invoke("definition.save");
  expect(submitted(2)).toEqual(["/description"]);
});

it("names the fields a draft wrote, and not the ones it left out", async () => {
  const { context, submitted } = await open({ name: "Analyst v2", skills: [sql, chart] });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name", "/skills"])), { timeout: 5000 });
  await context.instance.invoke("definition.save");
  expect(new Set(submitted(0))).toEqual(new Set(["/name", "/skills"]));
});

it("does not count a field the draft left out, even though the owner's checked values carry it", async () => {
  const { context, submitted } = await open({ name: "Analyst v2" });
  await vi.waitFor(() => expect(context.draft.value?.changed).toEqual(new Set(["/name"])), { timeout: 5000 });
  await context.instance.invoke("definition.save");
  expect(submitted(0)).toEqual(["/name"]);
});

it("forgets what was submitted once the reader discards", async () => {
  const { context, form, submitted } = await open();
  form.set("/skills", []);
  await nextTick();
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")][0]!.click();
  await nextTick();
  form.set("/name", "Analyst v3");
  await context.instance.invoke("definition.save");
  expect(submitted(0)).toEqual(["/name"]);
});
