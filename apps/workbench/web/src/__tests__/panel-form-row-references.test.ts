import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, SKILL } from "@ontomato/contracts/platform-object-types";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  humanIntents, ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A skill reference in each row of an owner form, through the platform's
 * real bridge and admission. The panel declares one ReferencePicker projection reading the skill catalogue with the
 * port `{slot: "definition", path: "/function/parameters", itemPath: "/skills"}`; the form draws its choice in every
 * row at `/function/parameters/<i>/skills`. Also the time control, whose value is the owner's HH:mm.
 *
 * The mistakes these catch: a row's reference drawn nowhere (or as "cannot be edited"); a choice written to the wrong
 * row, or left at the old index after its row moved; each row loading its own projection instead of sharing one; a
 * cleared time saved as text where the owner admits null.
 */

type Field = PanelFormDescription["fields"][number];
const field = (path: string, label: string, control: Field["control"], more: Partial<Field> = {}): Field =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });
const fields: Field[] = [
  field("/name", "Name", { kind: "text" }),
  field("/function", "Function", {
    kind: "object",
    fields: [field("/parameters", "Parameters", {
      kind: "object-array",
      itemKeyPath: "/name",
      defaultItem: { name: "", skills: [] },
      itemFields: [
        field("/name", "Parameter", { kind: "text" }),
        field("/skills", "Skills", { kind: "reference", objectType: SKILL, multiple: true }),
      ],
    })],
  }, { required: true }),
  field("/runAt", "Runs at", { kind: "time" }, { valueSchema: { type: ["string", "null"] } }),
];
const ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const skill = (name: string) => ({ namespace: { kind: "domain" as const, domainId: "domain-1" }, name });
const sql = skill("sql");
const chart = skill("chart");
const review = skill("review");
const stored: PanelFormValues = {
  id: ID,
  name: "Ship order",
  function: { parameters: [{ name: "order", skills: [sql] }, { name: "buyer", skills: [chart] }] },
  runAt: "09:30",
};
const parameters = (values: PanelFormValues) => (values.function as { parameters: PanelFormValues[] }).parameters;
const save = { method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: "agent.update" };
const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const, description: "",
  outputs: {}, config: {},
};
const skillSource = { type: { kind: "PlatformObjectType", id: SKILL } } as const;
const projections: Record<string, ProductProjection> = {
  "agent-form": {
    ...current, id: "agent-form", name: "Agent form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      agent: { kind: "object", objectType: AGENT_DEFINITION },
      values: { kind: "json" }, changedField: { kind: "scalar", type: "string" },
    },
    data: { form: {
      source: { object: { input: "agent" } }, read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
  },
  "parameter-skills": {
    ...current, id: "parameter-skills", name: "Parameter skills", componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { values: { kind: "json" } },
    data: {
      options: { source: skillSource, read: "options", params: {} },
      selected: { source: skillSource, read: "resolve", params: { values: { input: "values" } } },
    },
  },
};
const manifest = definePanel({
  state: { selected: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true } },
  members: {
    definition: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "selected" } } },
    skills: {
      target: { projectionId: "parameter-skills" },
      formField: { slot: "definition", path: "/function/parameters", itemPath: "/skills" },
    },
  },
  commands: {},
});
const panel = panelRecord("panel-row-references", "Row references", manifest);
/** The same form in a panel that declares no projection for the rows' skills. */
const bare = panelRecord("panel-row-references-bare", "Row references", definePanel({
  state: manifest.state, members: { definition: manifest.members.definition! }, commands: {},
}));

async function open(slots: string[], shown = panel) {
  const use = panelUse("use-row-references", "row-references", shown.id, "/ontology/agents");
  const intents = humanIntents(() => ({ kind: "success", data: {} }), { source: "input", input: "agent" });
  const sent = installPlatform((request: Sent) => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/assistant/agent-definitions/form") {
      const { values } = request.body as { values?: PanelFormValues };
      return Response.json({ fields, values: values ?? stored, errors: [], save });
    }
    if (request.path === "/api/assistant/agent-skills") {
      return Response.json({ skills: [
        { skill: sql, title: "SQL", description: "" },
        { skill: chart, title: "Charts", description: "" },
        { skill: review, title: "Review", description: "" },
      ] });
    }
    return intents(request) ?? nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, shown), true);
  writePanelDocument(registered("ontology", use, shown), use.path, { selected: { className: AGENT_DEFINITION, primaryKey: ID } } as never);
  inside(frame);
  const mounted = await mountPanel(panelOf(...slots));
  await vi.waitFor(() => expect(item("/name")?.querySelector("input")?.value).toBe("Ship order"), { timeout: 5000 });
  return { ...mounted, sent };
}

const item = (path: string) => document.querySelector<HTMLElement>(`#app [data-field="${path}"]`);
const row = (path: string) => document.querySelector<HTMLElement>(`#app [data-row="${path}"]`)!;
const button = (scope: Element, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label)!;
/** Chooses an option of the select inside a field as a reader does: opening it and clicking the option. */
async function choose(path: string, label: string) {
  item(path)!.querySelector<HTMLElement>(".el-select__wrapper")!.click();
  await nextTick();
  const listbox = document.getElementById(item(path)!.querySelector("input")!.getAttribute("aria-controls")!)!;
  [...listbox.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((option) => option.textContent?.trim() === label)!.click();
  await nextTick();
}
const saves = (sent: Sent[]) => sent.filter((request) => request.path === "/api/panel-operations/intents")
  .map(({ body }) => (body as { call: { input: { values: PanelFormValues } } }).call.input.values);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("draws the declared skill choice in each parameter row, and a choice follows its row when it moves", async () => {
  const { context, sent } = await open(["definition", "skills"]);
  await vi.waitFor(() => {
    expect(item("/function/parameters/0/skills")?.textContent).toContain("SQL");
    expect(item("/function/parameters/1/skills")?.textContent).toContain("Charts");
  }, { timeout: 5000 });
  expect(document.querySelector("#app .sdk-form-field-unavailable")).toBeNull();
  // Every row uses the same ReferencePicker projection. Selected values resolve in the context of each row.
  expect(sent.filter((request) => request.path === "/api/product-projections/parameter-skills")).toHaveLength(1);

  await choose("/function/parameters/1/skills", "Review");
  const form = context.instance.forms.handle("definition")!;
  expect(parameters(form.values.value)).toEqual([
    { name: "order", skills: [sql] },
    { name: "buyer", skills: [chart, review] },
  ]);
  // The row's choice is the form's own edit, marked on the form like any other.
  expect(context.instance.dirty()).toBe(true);

  // The second row moves up: its choice is drawn and edited at index 0 now.
  button(row("/function/parameters/1"), "Move up").click();
  await nextTick();
  await vi.waitFor(() => expect(item("/function/parameters/0/skills")?.textContent).toContain("Review"));
  await choose("/function/parameters/0/skills", "SQL");
  expect(parameters(form.values.value)).toEqual([
    { name: "buyer", skills: [chart, review, sql] },
    { name: "order", skills: [sql] },
  ]);

  await context.instance.invoke("definition.save");
  expect(parameters(saves(sent)[0]!)[0]).toEqual({ name: "buyer", skills: [chart, review, sql] });
  // Every request went through the frame's admission, under the form and the skill projection's declared reads.
  expect(sent.every((request) => request.credential !== null)).toBe(true);
});

it("says a row reference no projection of the panel is declared for cannot be edited, instead of hiding it", async () => {
  await open(["definition"], bare);
  const alerts = [...document.querySelectorAll("#app .sdk-form-row .sdk-form-field-unavailable")].map((alert) => alert.textContent?.trim());
  expect(alerts).toEqual(["Skills: This field cannot be edited here yet", "Skills: This field cannot be edited here yet"]);
  expect(item("/function/parameters/0/skills")).toBeNull();
});

it("edits a time as the owner's HH:mm, and a cleared one as null where the owner admits null", async () => {
  const { context, sent } = await open(["definition", "skills"]);
  const input = item("/runAt")!.querySelector("input")!;
  expect(input.type).toBe("time");
  expect(input.value).toBe("09:30");
  input.value = "18:05";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(saves(sent)[0]!.runAt).toBe("18:05");
  input.value = "";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(saves(sent)[1]!.runAt).toBeNull();
});
