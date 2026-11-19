import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges,
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * The real metric panel path: the SDK's registered metric adapter behind the platform's bridge and host. An ObjectList
 * bound to platform:MetricView lists and filters the owner's records and shows its status label; an ObjectForm bound to
 * the same type describes the selected metric and saves the owner's complete values.
 */

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};
const projection = (id: string, componentId: string, inputs: ProductProjection["inputs"], display: Record<string, unknown>): ProductProjection => ({
  ...current, id, name: id, description: "", componentId,
  binding: { kind: "PlatformObjectType", id: METRIC_VIEW }, inputs, display,
});
const projections: Record<string, ProductProjection> = {
  "metric-list": projection("metric-list", "ObjectList", {}, {
    columns: [{ key: "label", label: "Name" }, { key: "status", label: "Status", kind: "tag" }],
    searchable: true,
    showCount: true,
  }),
  "metric-form": projection("metric-form", "ObjectForm", { metric: { kind: "object", objectType: METRIC_VIEW } }, { creates: true }),
};
const manifest = definePanel({
  state: { selectedMetric: { kind: "object", objectType: METRIC_VIEW, deepLink: true } },
  slots: {
    list: { projectionId: "metric-list", inputs: {}, outputs: { selected: { state: "selectedMetric" } } },
    form: { projectionId: "metric-form", inputs: { metric: { state: "selectedMetric" } } },
  },
  operations: [],
});
const panel = panelRecord("panel-metric", "Metrics", manifest);
const use = panelUse("use-metric", "metrics", panel.id, "/applications/app-metric/metrics");

const assets = [
  {
    id: "m1", name: "Revenue", description: "Gross revenue", status: "PUBLISHED", statusLabel: "Published",
    origin: "USER", originLabel: "User", function: { name: "calc_revenue" }, bindings: [],
    createdBy: "u-1", createdByName: "Alice", reviewedBy: "u-2", reviewedByName: "Bob", modifyTimestamp: 0,
  },
  {
    id: "m2", name: "Churn", description: "Monthly churn", status: "PENDING_REVIEW", statusLabel: "Pending review",
    origin: "SYSTEM", originLabel: "System", function: { name: "calc_churn" }, bindings: [],
    createdBy: "u-1", createdByName: "Alice", reviewedBy: null, reviewedByName: null, modifyTimestamp: 0,
  },
];

const fields = [
  { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
  { path: "/description", label: "Description", control: { kind: "text", multiline: true }, valueSchema: { type: "string" }, required: false, readOnly: false },
  { path: "/status", label: "Status", control: { kind: "select", options: [
    { value: "PENDING_REVIEW", label: "Pending review", description: null, disabled: false, disabledReason: null },
    { value: "PUBLISHED", label: "Published", description: null, disabled: false, disabledReason: null },
    { value: "UNUSED", label: "Unused", description: null, disabled: false, disabledReason: null },
  ] }, valueSchema: { type: "string" }, required: false, readOnly: false },
];

const defaults = { name: "", description: "", status: "PENDING_REVIEW", origin: "USER", function: { name: "" }, bindings: [] };

function answer(request: Sent) {
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  if (request.path === "/api/data-query/metricView/queryList") return Response.json({ success: true, data: assets });
  if (request.path === "/api/data-query/metricView/form") {
    const body = request.body as { target: { kind: string; primaryKey?: string } };
    const create = body.target.kind === "draft";
    return Response.json({ success: true, data: {
      fields,
      values: create ? defaults : assets.find(asset => asset.id === body.target.primaryKey),
      save: { method: "POST", path: "/metricView/save", bodySchema: {}, draftOperation: create ? "metric-view.create" : "metric-view.update" },
    } });
  }
  if (request.path === "/api/data-query/metricView/save") {
    return Response.json({ success: true, data: { ...(request.body as object), id: "m1" } });
  }
  return nothingAt(request);
}

async function open() {
  const sent = installPlatform(answer);
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("app-metric", use, ignoreChanges).frame(frame, registered("app-metric", use, panel), true);
  writePanelDocument(registered("app-metric", use, panel), use.path, {});
  inside(frame);
  return { ...(await mountPanel(panelOf("list", "form"))), sent };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("lists metrics through the registered adapter, filters them, and shows the owner's status label", async () => {
  const { sent } = await open();
  await vi.waitFor(() => expect(document.querySelectorAll("#app tbody tr").length).toBe(2), { timeout: 5000 });

  expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("2");
  expect(document.querySelector('#app [data-tone="success"]')?.textContent?.trim()).toBe("Published");
  expect(document.querySelector('#app [data-tone="warning"]')?.textContent?.trim()).toBe("Pending review");
  const listRequest = sent.find(request => request.path === "/api/data-query/metricView/queryList");
  expect(listRequest?.body).toEqual({});
  expect(listRequest?.credential).not.toBeNull();

  const search = document.querySelector<HTMLInputElement>("#app input[type=search]")!;
  search.value = "CHURN";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelectorAll("#app tbody tr").length).toBe(1), { timeout: 5000 });
  expect(document.querySelector("#app tbody tr")?.textContent).toContain("Churn");
  expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("1");
});

it("describes and saves the selected metric through the owner's form", async () => {
  const { context, sent } = await open();
  await vi.waitFor(() => expect(document.querySelectorAll("#app tbody tr").length).toBe(2), { timeout: 5000 });

  document.querySelector<HTMLTableRowElement>("#app tbody tr")!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#app [data-field="/name"] input')?.value).toBe("Revenue"), { timeout: 5000 });
  expect(sent.filter(request => request.path === "/api/data-query/metricView/form").at(-1)?.body).toEqual({
    target: { kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, changedField: null,
  });

  const name = document.querySelector<HTMLInputElement>('#app [data-field="/name"] input')!;
  name.value = "Revenue 2";
  name.dispatchEvent(new Event("input"));
  await nextTick();
  await context.instance.invoke("form.save");

  const save = sent.find(request => request.path === "/api/data-query/metricView/save")!;
  expect(save.method).toBe("POST");
  expect(save.body).toMatchObject({ id: "m1", name: "Revenue 2", status: "PUBLISHED", bindings: [] });
  expect(save.credential).not.toBeNull();
});
