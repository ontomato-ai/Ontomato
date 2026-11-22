import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
// The code editor the SDK draws is the foundation package's; a test edits its document as a reader's keystrokes do.
import { EditorView } from "../../../../../packages/foundation-ui/node_modules/@codemirror/view";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { confirmDiscard, formSaveCalls, humanIntents, ignoreChanges,
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * The typed form controls an owner names (U5), drawn by the generic form through the platform's real bridge and
 * admission: parameter rows with their own fields, an optional nested object, Python and JSON code, and a list of
 * strings. Every request below went through the frame's admission, and the save sends the owner's own JSON.
 *
 * The mistakes these catch: a row field drawn at its relative path instead of the row's, so its message lands nowhere
 * or on another row; a message left at the old index after its row moved; an omitted object written as `{}` or null;
 * JSON that does not parse saved as a string; a code value that is text turned into JSON, or the other way round.
 */

type Field = PanelFormDescription["fields"][number];
const field = (path: string, label: string, control: Field["control"], more: Partial<Field> = {}): Field =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });

const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });
const fields: Field[] = [
  field("/name", "Name", { kind: "text" }, { required: true }),
  field("/parameters", "Parameters", {
    kind: "object-array",
    defaultItem: { name: "", type: "string", required: false },
    itemKeyPath: "/id",
    itemFields: [
      field("/id", "ID", { kind: "hidden" }),
      field("/name", "Parameter", { kind: "text" }),
      field("/type", "Type", { kind: "select", options: [option("string", "Text"), option("number", "Number")] },
        { refreshOnChange: true }),
      field("/required", "Required", { kind: "switch" }),
    ],
  }),
  field("/target", "Target", {
    kind: "object",
    defaultObject: { className: "Order", limit: 10 },
    fields: [field("/className", "Class", { kind: "text" }), field("/limit", "Limit", { kind: "number" })],
  }),
  field("/script", "Script", { kind: "code", language: "python" }, { valueSchema: { type: "string" } }),
  field("/schema", "Schema", { kind: "code", language: "json" }, { valueSchema: { type: "object" } }),
  field("/tags", "Tags", { kind: "string-array" }),
];
const ID = "0b6f6a62-4f0a-4c5e-9d4f-2f1f8a0c1a01";
const stored: PanelFormValues = {
  id: ID,
  name: "Ship order",
  parameters: [
    { id: "p-1", name: "orderId", type: "string", required: true },
    { id: "p-2", name: "count", type: "number", required: false },
  ],
  script: "def run(order):\n    return order",
  schema: { type: "object" },
  tags: ["ops"],
};
const save = { method: "PUT" as const, path: "/assistant/agent-definitions/:id", bodySchema: {}, draftOperation: "agent.update" };
const projection: ProductProjection = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id: "agent-form", name: "Agent form", description: "", componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    agent: { kind: "object", objectType: AGENT_DEFINITION },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: "agent" } }, read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    },
  },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
};
const manifest = definePanel({
  state: { selected: { type: { kind: "object", objectType: AGENT_DEFINITION }, deepLink: true } },
  members: { definition: { target: { projectionId: projection.id }, inputs: { agent: { state: "selected" } } } },
  commands: {},
});
const panel = panelRecord("panel-form-controls", "Form controls", manifest);
const use = panelUse("use-form-controls", "form-controls", panel.id, "/ontology/agents");

const formPath = "/api/assistant/agent-definitions/form";
async function open(outcome: PanelOperationOutcome = { kind: "success", data: {} }, held: PanelFormValues = stored) {
  const intents = humanIntents(() => outcome, { source: "input", input: "agent" });
  const sent = installPlatform((request: Sent) => {
    if (request.path === `/api/product-projections/${projection.id}`) return Response.json({ projection });
    if (request.path === formPath) {
      const { values } = request.body as { values?: PanelFormValues };
      return Response.json({ fields, values: values ?? held, errors: [], save });
    }
    return intents(request) ?? nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), "/ontology/agents", { selected: { className: AGENT_DEFINITION, primaryKey: ID } } as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("definition"));
  await vi.waitFor(() => expect(item("/name")?.querySelector("input")?.value).toBe("Ship order"), { timeout: 5000 });
  return { ...mounted, sent };
}

const item = (path: string) => document.querySelector<HTMLElement>(`#app [data-field="${path}"]`);
const error = (path: string) => item(path)?.querySelector(":scope > .el-form-item__content > .el-form-item__error")?.textContent?.trim();
function type(path: string, text: string) {
  const input = item(path)!.querySelector<HTMLInputElement>("input, textarea")!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
}
const button = (scope: Element, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>(":scope > * > button, :scope > button")].find((element) => element.textContent?.trim() === label)!;
const row = (path: string) => document.querySelector<HTMLElement>(`#app [data-row="${path}"]`)!;
function code(path: string, text: string) {
  const view = EditorView.findFromDOM(item(path)!.querySelector<HTMLElement>(".cm-editor")!)!;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
const storedParameters = stored.parameters as PanelFormValues[];
const submitted = (sent: Sent[]) => sent.filter((request) => request.path === "/api/panel-operations/intents")
  .map(({ body }) => (body as { call: { input: { values: PanelFormValues } } }).call.input.values);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("edits parameter rows at their absolute paths, and a message follows its row when the rows move", async () => {
  const { context, sent } = await open({
    kind: "refusal", code: "INVALID_PARAMETERS", message: "Check the parameters",
    errors: [{ field: "/parameters/1/name", code: "invalid_object", message: "A parameter name is a word" }],
  });
  // Each row's fields at the row's current place; the hidden identity is drawn by no control.
  expect(item("/parameters/0/name")?.querySelector("input")?.value).toBe("orderId");
  expect(item("/parameters/1/name")?.querySelector("input")?.value).toBe("count");
  expect(item("/parameters/0/id")).toBeNull();

  type("/parameters/1/name", "count of");
  await nextTick();
  await expect(context.instance.invoke("definition.save")).rejects.toThrow("Check the parameters");
  expect(submitted(sent)[0]!).toMatchObject({ parameters: [storedParameters[0], { id: "p-2", name: "count of", type: "number", required: false }] });
  await vi.waitFor(() => expect(error("/parameters/1/name")).toBe("A parameter name is a word"));

  // The second row moves up: it and its message are now at index 0, and the values are in the new order.
  button(row("/parameters/1"), "Move up").click();
  await nextTick();
  expect(item("/parameters/0/name")?.querySelector("input")?.value).toBe("count of");
  expect(error("/parameters/0/name")).toBe("A parameter name is a word");
  expect(error("/parameters/1/name")).toBeFalsy();

  // A removed row takes its message with it; a new row starts from the owner's default.
  button(row("/parameters/0"), "Remove").click();
  await nextTick();
  expect(error("/parameters/0/name")).toBeFalsy();
  button(item("/parameters")!.querySelector(".sdk-form-rows")!, "Add").click();
  await nextTick();
  expect(item("/parameters/1/name")?.querySelector("input")?.value).toBe("");
  const form = context.instance.forms.handle("definition")!;
  expect(form.values.value.parameters).toEqual([storedParameters[0], { name: "", type: "string", required: false }]);
});

it("keeps acknowledged fields out of the next submission and discards only unsaved changes", async () => {
  const { context, sent } = await open({
    kind: "failure", code: "SAVE_FAILED", message: "Parameter write failed",
    savedFields: { "/name": "Saved name" },
    errors: [{ field: "/parameters/1/name", code: "target_unavailable", message: "Parameter write failed" }],
  });
  type("/name", "Saved name");
  type("/parameters/1/name", "Unsaved parameter");
  await nextTick();
  await expect(context.instance.invoke("definition.save")).rejects.toThrow("Parameter write failed");
  await vi.waitFor(() => expect(error("/parameters/1/name")).toBe("Parameter write failed"));
  await expect(context.instance.invoke("definition.save")).rejects.toThrow("Parameter write failed");
  expect(formSaveCalls(sent)[1]!.input).toMatchObject({ submittedFields: ["/parameters"] });

  item("/name")!.closest("form")!.querySelector<HTMLButtonElement>(".sdk-owner-form-actions button")!.click();
  await confirmDiscard();
  expect(item("/name")?.querySelector("input")?.value).toBe("Saved name");
  expect(item("/parameters/1/name")?.querySelector("input")?.value).toBe("count");
});

it("asks the owner again with a row field's absolute path when it refreshes the form", async () => {
  const { context, sent } = await open();
  context.instance.forms.handle("definition")!.set("/parameters/1/type", "string");
  const reads = () => sent.filter((request) => request.path === formPath);
  await vi.waitFor(() => expect(reads()).toHaveLength(2));
  expect(reads()[1]!.body).toMatchObject({ changedField: "/parameters/1/type" });
});

it("keeps an omitted object absent, adds it from the owner's default and removes it as null", async () => {
  const { context, sent } = await open();
  type("/name", "Ship orders");
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(Object.hasOwn(submitted(sent)[0]!, "target")).toBe(false);

  button(item("/target")!.querySelector(".sdk-form-object")!, "Add").click();
  await nextTick();
  expect(item("/target/className")?.querySelector("input")?.value).toBe("Order");
  expect(item("/target/limit")?.querySelector("input")?.value).toBe("10");
  // A number stays a number, and a cleared one is null, not 0.
  type("/target/limit", "25");
  await nextTick();
  expect(context.instance.forms.handle("definition")!.values.value.target).toEqual({ className: "Order", limit: 25 });
  type("/target/limit", "");
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(submitted(sent)[1]!.target).toEqual({ className: "Order", limit: null });

  button(item("/target")!.querySelector(".sdk-form-object")!, "Remove").click();
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(submitted(sent)[2]!.target).toBeNull();
});

it("saves Python as text and JSON as the owner's value, and never saves JSON that does not parse", async () => {
  const { context, sent } = await open();
  await vi.waitFor(() => expect(item("/schema")?.querySelector(".cm-editor")).toBeTruthy(), { timeout: 5000 });
  expect(item("/schema")!.textContent).toContain('"type": "object"');

  code("/schema", '{"type": ');
  await vi.waitFor(() => expect(error("/schema")).toMatch(/^Not valid JSON/));
  // The reader's text is unsaved although no value changed: a refresh does not replace it, and leaving asks.
  expect(context.instance.dirty()).toBe(true);
  await expect(context.instance.invoke("definition.save")).rejects.toThrow("Correct the marked fields before saving");
  expect(submitted(sent)).toHaveLength(0);

  code("/schema", '{"type": "array", "items": {"type": "string"}}');
  code("/script", "def run(order):\n    return None");
  await nextTick();
  expect(error("/schema")).toBeFalsy();
  await context.instance.invoke("definition.save");
  expect(submitted(sent)[0]!).toMatchObject({
    schema: { type: "array", items: { type: "string" } },
    script: "def run(order):\n    return None",
  });
});

// An empty JSON value is drawn empty, as every other empty field is, never as the word null; emptying the text empties
// the value instead of marking it as JSON that does not parse.
it("draws an empty JSON value as empty and saves emptied text as no value", async () => {
  const { context, sent } = await open(undefined, { ...stored, schema: null });
  await vi.waitFor(() => expect(item("/schema")?.querySelector(".cm-editor")).toBeTruthy(), { timeout: 5000 });
  expect(item("/schema")!.querySelector(".cm-content")!.textContent).toBe("");

  code("/schema", '{"type": "string"}');
  await nextTick();
  code("/schema", "");
  await nextTick();
  expect(error("/schema")).toBeFalsy();
  await context.instance.invoke("definition.save");
  expect(submitted(sent)[0]!).toMatchObject({ schema: null });
});

it("discarding unparsed JSON shows the value the form holds again", async () => {
  const { context } = await open();
  await vi.waitFor(() => expect(item("/schema")?.querySelector(".cm-editor")).toBeTruthy(), { timeout: 5000 });
  type("/name", "Changed");
  code("/schema", "{");
  await vi.waitFor(() => expect(error("/schema")).toMatch(/^Not valid JSON/));
  item("/name")!.closest("form")!.querySelector<HTMLButtonElement>(".sdk-owner-form-actions button")!.click();
  await confirmDiscard();
  await vi.waitFor(() => expect(error("/schema")).toBeFalsy());
  expect(item("/schema")!.textContent).toContain('"type": "object"');
  expect(context.instance.dirty()).toBe(false);
});

it("edits a list of strings as the owner's array", async () => {
  const { context, sent } = await open();
  const tags = item("/tags")!.querySelector(".sdk-form-rows")!;
  button(tags, "Add").click();
  await nextTick();
  const inputs = tags.querySelectorAll<HTMLInputElement>("input");
  inputs[1]!.value = "billing";
  inputs[1]!.dispatchEvent(new Event("input"));
  await nextTick();
  button(tags.querySelector(".sdk-form-string-row")!, "Remove").click();
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(submitted(sent)[0]!.tags).toEqual(["billing"]);
});
