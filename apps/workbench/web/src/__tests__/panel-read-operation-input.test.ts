import { afterEach, expect, it, vi } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { FUNCTION } from "@ontomato/contracts/panel-client-requests";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * The input of a read-only operation (M5's trial run) as the panel's declaration says to fill it
 * (`readOperationInputs`): parameters from a panel state field and from a field of a form in the panel, read at the
 * moment of the call, and the binding from state. The draft is the form the owner's operation targets.
 *
 * The mistakes these catch: a parameter read when the panel opened rather than when the reader runs it, so their
 * latest edit is not what runs; a source that holds nothing sent as null instead of being left out.
 */

const fields = [
  { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
  { path: "/sample", label: "Sample", control: { kind: "number" }, valueSchema: {}, required: false, readOnly: false },
];
const record = (id: string, inputs: ProductProjection["inputs"]): ProductProjection => ({
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain",
  id, name: id, description: "", componentId: "ObjectForm", binding: { kind: "PlatformObjectType", id: FUNCTION }, inputs, display: {},
});
const projections: Record<string, ProductProjection> = {
  "function-form": record("function-form", { fn: { kind: "object", objectType: FUNCTION } }),
  "trial-form": record("trial-form", { fn: { kind: "object", objectType: FUNCTION } }),
};
const manifest = definePanel({
  state: {
    selected: { kind: "object", objectType: FUNCTION, deepLink: true },
    region: { kind: "scalar", type: "string", deepLink: false },
    binding: { kind: "scalar", type: "string", deepLink: false },
    month: { kind: "scalar", type: "string", deepLink: false },
  },
  slots: {
    definition: {
      projectionId: "function-form", inputs: { fn: { state: "selected" } },
      readOperationInputs: {
        testExecute: {
          parameters: { fields: { region: { state: "region" }, sample: { formField: { slot: "trial", path: "/sample" } }, month: { state: "month" } } },
          bindingId: { state: "binding" },
        },
        test: { parameters: { formField: { slot: "trial", path: "/parameters" } } },
      },
    },
    trial: { projectionId: "trial-form", inputs: { fn: { state: "selected" } } },
  },
  operations: [],
});
const panel = panelRecord("panel-read-input", "Functions", manifest);
const use = panelUse("use-read-input", "read-input", panel.id, "/ontology/functions");

async function open() {
  installPlatform((request: Sent) => {
    const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (projected) return Response.json({ projection: projections[projected[1]!] });
    if (request.path === "/api/data-query/function/form")
      return Response.json({ success: true, data: {
        fields, values: { id: "fn-1", name: "Revenue", sample: 3, parameters: { month: "2026-10", limit: 5 } },
        save: { method: "POST", path: "/function/save", bodySchema: {}, draftOperation: "function.update" },
      } });
    return nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const { readOperationInput } = await import("../../../../../packages/apps-sdk/src/panel/read-operation-input");
  const frame = panelFrame();
  platformPanelHost("ontology", use).frame(frame, registered("ontology", use, panel), true);
  writePanelDocument(panel, use, "/ontology/functions", { selected: { className: FUNCTION, primaryKey: "fn-1" } } as never);
  inside(frame);
  const mounted = await mountPanel(panelOf("definition", "trial"));
  await vi.waitFor(() => expect(mounted.context.instance.forms.handle("trial")?.values.value.sample).toBe(3), { timeout: 5000 });
  return { ...mounted, readOperationInput };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("reads each declared source when the operation runs, and leaves out one that holds nothing", async () => {
  const { context, readOperationInput } = await open();
  const draft: PanelFormValues = { name: "Revenue" };
  context.instance.state.set("region", "east");
  context.instance.state.set("binding", "binding-1");
  // The reader changes the trial form after the panel opened: the run takes what the form holds now.
  context.instance.forms.handle("trial")!.set("/sample", 7);
  expect(readOperationInput(context.instance, "definition", "testExecute", draft)).toEqual({
    draft, parameters: { region: "east", sample: 7, month: null }, bindingId: "binding-1",
  });
});

it("takes one object of a form as the parameters when the declaration names a single source", async () => {
  const { context, readOperationInput } = await open();
  expect(readOperationInput(context.instance, "definition", "test", {})).toEqual({
    draft: {}, parameters: { month: "2026-10", limit: 5 },
  });
});
