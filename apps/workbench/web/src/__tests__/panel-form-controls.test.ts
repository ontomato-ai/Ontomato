import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
// The code editor the SDK draws is the foundation package's; a test edits its document as a reader's keystrokes do.
import { EditorView } from "../../../../../packages/foundation-ui/node_modules/@codemirror/view";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
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
const ID = "fn-1";
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
const save = { method: "POST" as const, path: "/function/save", bodySchema: {}, draftOperation: "function.update" };
const projection: ProductProjection = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id: "function-form", name: "function-form", description: "", componentId: "ObjectForm",
  binding: { kind: "PlatformObjectType", id: FUNCTION },
  inputs: { fn: { kind: "object", objectType: FUNCTION } }, display: {},
};
const manifest = definePanel({
  state: { selected: { kind: "object", objectType: FUNCTION, deepLink: true } },
  slots: { definition: { projectionId: "function-form", inputs: { fn: { state: "selected" } } } },
  operations: [],
});
const panel = panelRecord("panel-form-controls", "Form controls", manifest);
const use = panelUse("use-form-controls", "form-controls", panel.id, "/ontology/functions");

/** The function owner's envelope: a success with its data, or a refusal naming fields by their absolute pointers. */
const ok = (data: unknown) => Response.json({ success: true, data });
async function open(saved: (values: PanelFormValues) => Response = (values) => ok(values)) {
  const sent = installPlatform((request: Sent) => {
    if (request.path === "/api/product-projections/function-form") return Response.json({ projection });
    if (request.path === "/api/data-query/function/form") {
      const { values } = request.body as { values?: PanelFormValues };
      return ok({ fields, values: values ?? stored, save });
    }
    if (request.path === "/api/data-query/function/save") return saved(request.body as PanelFormValues);
    return nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(panel, use, "/ontology/functions", { selected: { className: FUNCTION, primaryKey: ID } } as never);
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
const puts = (sent: Sent[]) => sent.filter((request) => request.path === "/api/data-query/function/save");

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("edits parameter rows at their absolute paths, and a message follows its row when the rows move", async () => {
  const { context, sent } = await open(() => Response.json({
    success: false, message: "Check the parameters",
    fields: [{ field: "/parameters/1/name", code: "invalid", message: "A parameter name is a word" }],
  }));
  // Each row's fields at the row's current place; the hidden identity is drawn by no control.
  expect(item("/parameters/0/name")?.querySelector("input")?.value).toBe("orderId");
  expect(item("/parameters/1/name")?.querySelector("input")?.value).toBe("count");
  expect(item("/parameters/0/id")).toBeNull();

  type("/parameters/1/name", "count of");
  await nextTick();
  await expect(context.instance.invoke("definition.save")).rejects.toThrow("Check the parameters");
  expect(puts(sent)[0]!.body).toMatchObject({ parameters: [storedParameters[0], { id: "p-2", name: "count of", type: "number", required: false }] });
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

it("asks the owner again with a row field's absolute path when it refreshes the form", async () => {
  const { context, sent } = await open();
  context.instance.forms.handle("definition")!.set("/parameters/1/type", "string");
  await vi.waitFor(() => expect(sent.filter((request) => request.path === "/api/data-query/function/form")).toHaveLength(2));
  expect(sent.at(-1)!.body).toMatchObject({ changedField: "/parameters/1/type" });
});

it("keeps an omitted object absent, adds it from the owner's default and removes it as null", async () => {
  const { context, sent } = await open();
  type("/name", "Ship orders");
  await nextTick();
  await context.instance.invoke("definition.save");
  expect(Object.hasOwn(puts(sent)[0]!.body as object, "target")).toBe(false);

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
  expect((puts(sent)[1]!.body as PanelFormValues).target).toEqual({ className: "Order", limit: null });

  button(item("/target")!.querySelector(".sdk-form-object")!, "Remove").click();
  await nextTick();
  await context.instance.invoke("definition.save");
  expect((puts(sent)[2]!.body as PanelFormValues).target).toBeNull();
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
  expect(puts(sent)).toHaveLength(0);

  code("/schema", '{"type": "array", "items": {"type": "string"}}');
  code("/script", "def run(order):\n    return None");
  await nextTick();
  expect(error("/schema")).toBeFalsy();
  await context.instance.invoke("definition.save");
  expect(puts(sent)[0]!.body).toMatchObject({
    schema: { type: "array", items: { type: "string" } },
    script: "def run(order):\n    return None",
  });
});

it("discarding unparsed JSON shows the value the form holds again", async () => {
  const { context } = await open();
  await vi.waitFor(() => expect(item("/schema")?.querySelector(".cm-editor")).toBeTruthy(), { timeout: 5000 });
  type("/name", "Changed");
  code("/schema", "{");
  await vi.waitFor(() => expect(error("/schema")).toMatch(/^Not valid JSON/));
  item("/name")!.closest("form")!.querySelector<HTMLButtonElement>(".sdk-owner-form-actions button")!.click();
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
  expect((puts(sent)[0]!.body as PanelFormValues).tags).toEqual(["billing"]);
});
