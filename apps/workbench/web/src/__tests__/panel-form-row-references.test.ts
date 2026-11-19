import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { FUNCTION, OBJECT_TYPE } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A reference in each row of an owner form (M6's action parameters: each parameter's classes), through the platform's
 * real bridge and admission. The panel declares one ReferencePicker projection bound to the class catalogue with the
 * port `{slot: "definition", path: "/function/parameters", itemPath: "/classNames"}`; the form draws its choice in every
 * row at `/function/parameters/<i>/classNames`. Also the time control, whose value is the owner's HH:mm.
 *
 * The mistakes these catch: a row's reference drawn nowhere (or as "cannot be edited"); a choice written to the wrong
 * row, or left at the old index after its row moved; one catalogue read per row instead of the projection's one; a
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
      defaultItem: { name: "", classNames: [] },
      itemFields: [
        field("/name", "Parameter", { kind: "text" }),
        field("/classNames", "Classes", { kind: "reference", objectType: OBJECT_TYPE, multiple: true }),
      ],
    })],
  }, { required: true }),
  field("/runAt", "Runs at", { kind: "time" }, { valueSchema: { type: ["string", "null"] } }),
];
const ID = "fn-1";
const stored: PanelFormValues = {
  id: ID,
  name: "Ship order",
  function: { parameters: [{ name: "order", classNames: ["Order"] }, { name: "buyer", classNames: ["Customer"] }] },
  runAt: "09:30",
};
const parameters = (values: PanelFormValues) => (values.function as { parameters: PanelFormValues[] }).parameters;
const save = { method: "POST" as const, path: "/function/save", bodySchema: {}, draftOperation: "function.update" };
const record = (id: string, componentId: string, binding: string, inputs: ProductProjection["inputs"] = {}): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId, binding: { kind: "PlatformObjectType", id: binding }, inputs, display: {},
});
const projections: Record<string, ProductProjection> = {
  "action-form": record("action-form", "ObjectForm", FUNCTION, { fn: { kind: "object", objectType: FUNCTION } }),
  "parameter-classes": record("parameter-classes", "ReferencePicker", OBJECT_TYPE),
};
const manifest = definePanel({
  state: { selected: { kind: "object", objectType: FUNCTION, deepLink: true } },
  slots: {
    definition: { projectionId: "action-form", inputs: { fn: { state: "selected" } } },
    classes: {
      projectionId: "parameter-classes", inputs: {},
      formField: { slot: "definition", path: "/function/parameters", itemPath: "/classNames" },
    },
  },
  operations: [],
});
const panel = panelRecord("panel-row-references", "Row references", manifest);
/** The same form in a panel that declares no projection for the rows' classes. */
const bare = panelRecord("panel-row-references-bare", "Row references", definePanel({
  state: manifest.state, slots: { definition: manifest.slots.definition! }, operations: [],
}));

const ok = (data: unknown) => Response.json({ success: true, data });
async function open(slots: string[], shown = panel, saved: (values: PanelFormValues) => Response = ok) {
  const use = panelUse("use-row-references", "row-references", shown.id, "/ontology/actions");
  const sent = installPlatform((request: Sent) => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/data-query/function/form") {
      const { values } = request.body as { values?: PanelFormValues };
      return ok({ fields, values: values ?? stored, save });
    }
    if (request.path === "/api/data-query/function/save") return saved(request.body as PanelFormValues);
    if (request.path === "/api/data-query/admin/getMetas")
      return ok({
        classDef: [{ className: "Order", showName: "Orders" }, { className: "Customer", showName: "Customers" }, { className: "Invoice", showName: "Invoices" }],
        relationship_rule: {},
      });
    return nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use).frame(frame, registered("ontology", use, shown), true);
  writePanelDocument(shown, use, "/ontology/actions", { selected: { className: FUNCTION, primaryKey: ID } } as never);
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
const saves = (sent: Sent[]) => sent.filter((request) => request.path === "/api/data-query/function/save");

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("draws the declared class choice in each parameter row, and a choice follows its row when it moves", async () => {
  const { context, sent } = await open(["definition", "classes"]);
  await vi.waitFor(() => {
    expect(item("/function/parameters/0/classNames")?.textContent).toContain("Orders");
    expect(item("/function/parameters/1/classNames")?.textContent).toContain("Customers");
  }, { timeout: 5000 });
  expect(document.querySelector("#app .sdk-form-field-unavailable")).toBeNull();
  // The rows' choices drew from one catalogue read of the one projection, not one per row.
  expect(sent.filter((request) => request.path === "/api/data-query/admin/getMetas")).toHaveLength(1);

  await choose("/function/parameters/1/classNames", "Invoices");
  const form = context.instance.forms.handle("definition")!;
  expect(parameters(form.values.value)).toEqual([
    { name: "order", classNames: ["Order"] },
    { name: "buyer", classNames: ["Customer", "Invoice"] },
  ]);
  // The row's choice is the form's own edit, marked on the form like any other.
  expect(context.instance.dirty()).toBe(true);

  // The second row moves up: its choice is drawn and edited at index 0 now.
  button(row("/function/parameters/1"), "Move up").click();
  await nextTick();
  await vi.waitFor(() => expect(item("/function/parameters/0/classNames")?.textContent).toContain("Invoices"));
  await choose("/function/parameters/0/classNames", "Orders");
  expect(parameters(form.values.value)).toEqual([
    { name: "buyer", classNames: ["Customer", "Invoice", "Order"] },
    { name: "order", classNames: ["Order"] },
  ]);

  await context.instance.invoke("definition.save");
  expect(parameters(saves(sent)[0]!.body as PanelFormValues)[0]).toEqual({ name: "buyer", classNames: ["Customer", "Invoice", "Order"] });
  // Every request went through the frame's admission, under the class projection's binding.
  expect(sent.every((request) => request.credential !== null)).toBe(true);
  expect(sent.every((request) => request.credential !== null)).toBe(true);
});

it("says a row reference no projection of the panel is declared for cannot be edited, instead of hiding it", async () => {
  await open(["definition"], bare);
  const alerts = [...document.querySelectorAll("#app .sdk-form-row .sdk-form-field-unavailable")].map((alert) => alert.textContent?.trim());
  expect(alerts).toEqual(["Classes: This field cannot be edited here yet", "Classes: This field cannot be edited here yet"]);
  expect(item("/function/parameters/0/classNames")).toBeNull();
});

it("edits a time as the owner's HH:mm, and a cleared one as null where the owner admits null", async () => {
  const { context, sent } = await open(["definition", "classes"]);
  const input = item("/runAt")!.querySelector("input")!;
  expect(input.type).toBe("time");
  expect(input.value).toBe("09:30");
  input.value = "18:05";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  expect((saves(sent)[0]!.body as PanelFormValues).runAt).toBe("18:05");
  input.value = "";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("definition.save");
  expect((saves(sent)[1]!.body as PanelFormValues).runAt).toBeNull();
});
