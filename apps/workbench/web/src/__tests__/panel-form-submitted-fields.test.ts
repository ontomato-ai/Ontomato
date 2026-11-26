import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, SKILL } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { answerSkillPickerRead, confirmDiscard,
  formSaveCalls, humanIntents, ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, panelWithSlots, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * What the form tells its owner it submitted (`submittedFields`), through the platform's real bridge: the save's input
 * is observed where the form prepares its write through the coordinator. The owner decides from it whether an agent's
 * skills are part of the update. A field the reader set counts even when it ends where it began (cleared to an empty
 * list, or set back to the value shown); a field a draft wrote counts; one neither touched is never added.
 *
 * The mistakes these catch: a save that names no fields, so an owner that keeps what was not submitted cannot tell an
 * emptied list from an untouched one; a field counted only when its value differs; a draft's absent field filled in.
 */

const sql = { namespace: { kind: "domain" as const, domainId: "domain-1" }, name: "sql" };
const chart = { namespace: { kind: "domain" as const, domainId: "domain-1" }, name: "chart" };
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
const skillPicker = (id: string) => {
  const source = { type: { kind: "PlatformObjectType" as const, id: SKILL } };
  const agentTarget = { input: "agentTarget" };
  return projection(id, {
    componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { agentTarget: { kind: "scalar", type: "string" } },
    data: {
      options: { source, read: "options", params: { agentTarget } },
      selected: { source, read: "resolve", params: { agentTarget } },
    },
  });
};
const projections: Record<string, ProductProjection> = {
  "agent-form": projection("agent-form", {
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: formInputs,
    data: {
      form: { source: { object: { input: "agent" } }, read: "form", params: formParams },
    },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
  }),
  "agent-skills": skillPicker("agent-skills"),
};
const manifest = definePanel({
  state: { selectedAgent: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true } },
  members: {
    definition: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selectedAgent" } } },
    skills: { target: { projectionId: "agent-skills" }, inputs: { agentTarget: { state: "selectedAgent", field: "primaryKey" } } },
  },
});
const panel = panelRecord("panel-submitted", "Agents", manifest, { definition: { "field-skills": "skills" } });
const use = panelUse("use-submitted", "submitted", panel.id, "/ontology/agents");

/** The definitions service: returns the form with stored values merged with any checked values. */
function owner(request: Sent, held: PanelFormValues): Response | undefined {
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/assistant/agent-definitions/form") {
    const { values } = request.body as { values?: PanelFormValues };
    return Response.json({ fields, values: { ...held, ...values }, errors: [], save });
  }
  return answerSkillPickerRead(request, [AGENT], [{ skill: sql, label: "SQL" }, { skill: chart, label: "Charts" }]);
}

async function open(shown: PanelFormValues = stored) {
  const intents = humanIntents(() => ({ kind: "success", data: {} }), { source: "input", input: "agent" });
  const sent = installPlatform((request) => intents(request) ?? owner(request, shown) ?? nothingAt(request));
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), "/ontology/agents", { selectedAgent: { className: AGENT_DEFINITION, primaryKey: AGENT } } as never);
  inside(frame);
  const mounted = await mountPanel(panelWithSlots(["definition"], { definition: { "field-skills": "skills" } }));
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#app [data-field="/name"] input')?.value).toBeTruthy(), { timeout: 5000 });
  const saves = () => formSaveCalls(sent);
  const submitted = (call: number) => saves()[call]!.input.submittedFields;
  return { ...mounted, form: mounted.context.instance.forms.handle("definition")!, saves, submitted };
}

/** The form's own save button, as the reader sees and clicks it. */
const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")]
  .find((button) => button.textContent?.trim() === "Save")!;

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

it("names the fields live fillForm wrote, and not the ones it left out", async () => {
  const { context, form, submitted } = await open();
  const outcome = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v2", "/skills": [sql, chart] },
  });
  expect(outcome).toMatchObject({ ok: true, member: "definition", filledFields: ["/name", "/skills"] });
  expect(form.changed.value).toEqual(new Set(["/name", "/skills"]));
  await context.instance.invoke("definition.save");
  expect(new Set(submitted(0))).toEqual(new Set(["/name", "/skills"]));
});

it("does not count a field fillForm left out, even though the owner's values carry it", async () => {
  const { context, form, submitted } = await open();
  const outcome = await context.instance.fillForm({
    member: "definition",
    values: { "/name": "Analyst v2" },
  });
  expect(outcome).toMatchObject({ ok: true, member: "definition", filledFields: ["/name"] });
  expect(form.changed.value).toEqual(new Set(["/name"]));
  await context.instance.invoke("definition.save");
  expect(submitted(0)).toEqual(["/name"]);
});

it("forgets what was submitted once the reader discards", async () => {
  const { context, form, submitted } = await open();
  form.set("/skills", []);
  await nextTick();
  [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")][0]!.click();
  await confirmDiscard();
  await nextTick();
  form.set("/name", "Analyst v3");
  await context.instance.invoke("definition.save");
  expect(submitted(0)).toEqual(["/name"]);
});

it("lets the reader save a field set back to the value shown, such as skills cleared to the empty list they showed", async () => {
  const { form, saves, submitted } = await open({ ...stored, skills: [] });
  form.set("/skills", [sql]);
  form.set("/skills", []);
  await nextTick();
  // The values are as they were read, and the reader's intent to submit the skills still stands.
  expect(saveButton().disabled).toBe(false);
  saveButton().click();
  await vi.waitFor(() => expect(saves()).toHaveLength(1));
  expect(submitted(0)).toEqual(["/skills"]);
});

it("keeps a field filled as the value shown, and saves it from the button", async () => {
  const { context, saves, submitted } = await open({ ...stored, skills: [] });
  const outcome = await context.instance.fillForm({
    member: "definition",
    values: { "/skills": [] },
  });
  expect(outcome).toMatchObject({ ok: true, member: "definition", filledFields: ["/skills"] });
  await vi.waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 5000 });
  saveButton().click();
  await vi.waitFor(() => expect(saves()).toHaveLength(1));
  expect(submitted(0)).toEqual(["/skills"]);
});
