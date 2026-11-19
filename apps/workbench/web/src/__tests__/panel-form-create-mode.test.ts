import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * A panel that creates by its own state (M7's business knowledge: `mode` set to `create`), beside a list that selects its
 * first row whenever its selection is not among its rows. Through the platform's real bridge and admission.
 *
 * The mistake this catches: the form's new object depending on an empty selection, so the list selecting its first row
 * again — on a reload, or when the panel opens at a `mode=create` address — turns the reader's new object into an edit of
 * that row and their typing is gone.
 */

const assets = [{ id: "fn-1", name: "Revenue" }, { id: "fn-2", name: "Churn" }];
const fields = [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }];
const save = (operation: string) => ({ method: "POST", path: "/function/save", bodySchema: {}, draftOperation: operation });
const record = (id: string, componentId: string, inputs: ProductProjection["inputs"], display: Record<string, unknown>): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId, binding: { kind: "PlatformObjectType", id: FUNCTION }, inputs, display,
});
const projections: Record<string, ProductProjection> = {
  "function-list": record("function-list", "ObjectList", {}, { selectable: true, fallbackToFirst: true }),
  "function-form": record("function-form", "ObjectForm", {
    fn: { kind: "object", objectType: FUNCTION }, mode: { kind: "scalar", type: "string" },
  }, { creates: true, createWhen: { input: "mode", equals: "create" } }),
};
const manifest = definePanel({
  state: {
    selected: { kind: "object", objectType: FUNCTION, deepLink: true },
    mode: { kind: "scalar", type: "string", deepLink: true },
  },
  slots: {
    list: { projectionId: "function-list", inputs: {}, outputs: { selected: { state: "selected" } } },
    form: { projectionId: "function-form", inputs: { fn: { state: "selected" }, mode: { state: "mode" } } },
  },
  operations: [],
});
const panel = panelRecord("panel-create-mode", "Functions", manifest);
const use = panelUse("use-create-mode", "create-mode", panel.id, "/ontology/functions");

const ok = (data: unknown) => Response.json({ success: true, data });
async function open(state: Record<string, unknown>) {
  const sent = installPlatform((request: Sent) => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/data-query/function/queryList") return ok(assets);
    if (request.path === "/api/data-query/function/form") {
      const { target } = request.body as { target: { kind: string; primaryKey?: string } };
      const values = target.kind === "draft" ? { name: "" } : assets.find((asset) => asset.id === target.primaryKey)!;
      return ok({ fields, values, save: save(target.kind === "draft" ? "function.create" : "function.update") });
    }
    if (request.path === "/api/data-query/function/save") return ok({ id: "fn-new", ...(request.body as PanelFormValues) });
    return nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("ontology", use, ignoreChanges).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(registered("ontology", use, panel), "/ontology/functions", state as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("list", "form"));
  return { ...mounted, sent };
}

const name = () => document.querySelector<HTMLInputElement>('#app [data-field="/name"] input');
const formReads = (sent: Sent[]) => sent.filter((request) => request.path === "/api/data-query/function/form")
  .map((request) => (request.body as { target: { kind: string; primaryKey?: string } }).target);

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("opened at a creating address, keeps the new object while the list selects its first row, and edits what it saved", async () => {
  const { context, sent } = await open({ mode: "create" });
  // The list selected its first row; the form is still on the new object.
  await vi.waitFor(() => {
    expect(context.instance.state.values.value.selected).toEqual({ className: FUNCTION, primaryKey: "fn-1" });
    expect(name()?.value).toBe("");
  }, { timeout: 5000 });
  expect(formReads(sent)).toEqual([{ kind: "draft" }]);

  name()!.value = "Margin";
  name()!.dispatchEvent(new Event("input"));
  await nextTick();
  // The list reloads, and selects its first row again: the reader's typing stays.
  context.instance.refreshObjects();
  await vi.waitFor(() => expect(sent.filter((request) => request.path === "/api/data-query/function/queryList")).toHaveLength(2));
  await nextTick();
  expect(name()!.value).toBe("Margin");
  expect(formReads(sent)).toEqual([{ kind: "draft" }]);

  await context.instance.invoke("form.save");
  expect(sent.find((request) => request.path === "/api/data-query/function/save")!.body).toEqual({ name: "Margin" });
  // Saved, the panel no longer creates: it selects the object the owner created and the form edits it.
  await vi.waitFor(() => expect(context.instance.state.values.value).toMatchObject({
    selected: { className: FUNCTION, primaryKey: "fn-new" }, mode: null,
  }));
});

it("turns to a new object when the panel's state says it creates, whatever is selected", async () => {
  const { context, sent } = await open({});
  await vi.waitFor(() => expect(name()?.value).toBe("Revenue"), { timeout: 5000 });
  context.instance.state.set("mode", "create");
  await vi.waitFor(() => expect(name()?.value).toBe(""));
  expect(context.instance.state.values.value.selected).toEqual({ className: FUNCTION, primaryKey: "fn-1" });
  expect(formReads(sent).at(-1)).toEqual({ kind: "draft" });
});
