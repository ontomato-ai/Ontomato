import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import { DELETE_METRIC_VIEW, METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import {
  candidateFiles, manifest, panelMaterial, projectionMaterial,
} from "../../../../../packages/apps-sdk/examples/panels/metric-views/material.mjs";
import {
  currentSdk, hostMessageOf, inside, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelHostFrame, READER,
  SDK_VERSION, writeFrameDocument, type Sent,
} from "./panel-frame";

/*
 * The metric views panel's candidate, as an author previews it: the workspace files `material.mjs` writes, read through
 * Node's candidate port and shown by the platform's own preview route, panel host, app host and bridge, with the panel's
 * own module running on the SDK's modules in the frame. Only the network is a stand-in: the metric owner answers its
 * list, its form and its refusal of a build-test write as the data engine does.
 *
 * What this rules out: a list that drops the owner's columns or status labels, or filters in the panel; a mode that
 * does not follow the selection; a form read from anywhere but the owner's form for the chosen target; a create that
 * does not start from the owner's draft; a delete aimed at anything but the selected metric view under the input name
 * the owner's operation reads; a candidate that saves live; and panel words the frame never receives.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const previewPath = `/app-builder/${WORKSPACE}/panel-preview/working/metric-views`;
const BUILD_TEST = JSON.stringify({ kind: "build-test", contextId: null });

/** What D's candidate port answers for the workspace holding `material.mjs`'s files. */
function candidate(): CandidatePanelSource {
  const files = Object.fromEntries(candidateFiles(SDK_VERSION).map(file => [file.path, file.content]));
  const { content, ...descriptor } = JSON.parse(files["panel.json"]!);
  return {
    kind: "candidate",
    workspace: { id: WORKSPACE, ref: "working" },
    panel: { ...descriptor, content: { html: files["panel.html"], module: files["panel.mjs"], recipes: files["recipes.md"], ...content } },
    previewContext: { kind: "build-test", test: null },
  };
}

/** The projections as a registration makes them, by their final IDs. */
const projections: Record<string, ProductProjection> = Object.fromEntries(projectionMaterial().projections.map(({ id, input }) => [id, {
  ...input, id, domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false,
} as ProductProjection]));

const readFunction = (name: string) => ({
  name, operation: "OPERATION_READ", logic: "",
  queryPackage: { manifest: { parameterDefs: [{ name: "period" }] } }, returnDef: { columnLabels: { total: "Total" } },
});
/** The metric owner's assets, as `/metricView/queryList` and `/metricView/form` give them. */
const assets = [
  {
    id: "m1", name: "Revenue", description: "Gross revenue", status: "PUBLISHED", statusLabel: "Published",
    origin: "USER", originLabel: "User", matchQuestions: ["revenue this month"], function: readFunction("calc_revenue"),
    bindings: [{ id: "b1", name: "Monthly revenue", description: "", matchQuestions: [], parameters: { period: "month" } }],
    createdBy: "u-1", createdByName: "Alice", reviewedBy: "u-2", reviewedByName: "Bob", modifyTimestamp: 0,
  },
  {
    id: "m2", name: "Churn", description: "Monthly churn", status: "PENDING_REVIEW", statusLabel: "Pending review",
    origin: "SYSTEM", originLabel: "System", matchQuestions: [], function: readFunction("calc_churn"), bindings: [],
    createdBy: "u-1", createdByName: "Alice", reviewedBy: null, reviewedByName: null, modifyTimestamp: 0,
  },
];
const stored = (id: string): PanelFormValues => {
  const { statusLabel: _status, originLabel: _origin, createdByName: _created, reviewedByName: _reviewed, ...values } = assets.find(asset => asset.id === id)!;
  return values;
};
const defaults: PanelFormValues = {
  name: "", description: "", status: "PENDING_REVIEW", matchQuestions: [],
  function: { name: "", operation: "OPERATION_READ", logic: "", queryPackage: {}, returnDef: { columnLabels: {} } }, bindings: [],
};

const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });
const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"], more = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });
/** The metric owner's form, as `/metricView/form` describes it: its code and array fields are its own, drawn or not. */
const fields: PanelFormDescription["fields"] = [
  field("/name", "Name", { kind: "text" }, { required: true }),
  field("/description", "Description", { kind: "text", multiline: true }),
  field("/status", "Status", { kind: "select", options: [
    option("PENDING_REVIEW", "Pending review"), option("PUBLISHED", "Published"), option("UNUSED", "Unused"),
  ] }),
  field("/matchQuestions", "Matching questions", { kind: "string-array" }),
  field("/function/name", "Function name", { kind: "text" }),
  field("/function/queryPackage", "Query package", { kind: "code", language: "json" }, { required: true, refreshOnChange: true }),
  field("/function/returnDef/columnLabels", "Column labels", { kind: "code", language: "json" }),
  field("/function/logic", "Logic", { kind: "text", multiline: true }),
  field("/bindings", "Bindings", { kind: "object-array", itemKeyPath: "/id", itemFields: [
    field("/id", "Binding ID", { kind: "hidden" }),
    field("/name", "Name", { kind: "text" }),
    field("/parameters/period", "period", { kind: "code", language: "json" }),
  ] }),
];
const save = (create: boolean) => ({
  method: "POST" as const, path: "/metricView/save", bodySchema: {}, draftOperation: create ? "metric-view.create" : "metric-view.update",
});
const owned = (data: unknown) => Response.json({ success: true, data });

/** Node's candidate port and the metric owner, as they answer the preview. */
function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === "/api/product-panels/definition-stream")
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  // The data engine's build-test guard refuses a save, which declares no test-data access, before the owner runs.
  if (request.path === "/api/data-query/metricView/save" && request.execution)
    return Response.json({ success: false, code: "BUILD_TEST_UNSUPPORTED", message: "This interface does not support test data" }, { status: 422 });
  if (request.path === "/api/data-query/metricView/queryList") return owned(assets);
  if (request.path === "/api/data-query/metricView/form") {
    const { target } = request.body as { target: { kind: string; primaryKey?: string } };
    const create = target.kind === "draft";
    return owned({ fields, values: create ? defaults : stored(target.primaryKey!), save: save(create) });
  }
  return nothingAt(request);
}

/** Opens the preview route the platform registers, at a state, and starts the panel's own module in its frame. */
async function preview(state: Record<string, unknown>) {
  const sent = installPlatform(owners);
  const routes = appBuilderPages().map(route => route.name === "PanelCandidatePreview" ? { ...route, component: PanelCandidateRoute } as RouteRecordRaw : route);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(panelAddress(previewPath, state));
  const page = mountPlatformPage(() => h(RouterView), router);
  const frame = await panelHostFrame();
  const offered: { id: string; kind: string; handlerRef: string; target?: unknown }[][] = [];
  window.addEventListener("message", event => {
    if (event.source === frame.contentWindow && event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "operations")
      offered.push(event.data.operations);
  });
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  // The candidate's own module, as the frame runs it: it imports the SDK and mounts the panel.
  // @ts-expect-error -- the panel's module is plain JavaScript, typed by the SDK it imports, not by a declaration of its own.
  await import("../../../../../packages/apps-sdk/examples/panels/metric-views/panel.mjs");
  /** A person's click on one of the panel's operations in the platform's header, as the panel host sends it. */
  const header = (id: string) => frame.contentWindow!.postMessage({ channel: PANEL_HOST_CHANNEL, kind: "invoke", requestId: `click-${id}`, id }, "*");
  return { ...page, router, sent, offered, header };
}

const rows = () => [...document.querySelectorAll<HTMLTableRowElement>("#app tbody tr")];
const fieldItem = (path: string) => document.querySelector(`#app [data-field="${path}"]`);
const titles = () => [...document.querySelectorAll("#app .sdk-section-group-title")].map(title => title.textContent);
const deleteButton = () => document.querySelector<HTMLButtonElement>("#app .sdk-operation-button button");
const formSave = () => [...document.querySelectorAll<HTMLButtonElement>("#app .sdk-owner-form-actions button")]
  .find(button => button.textContent?.trim() === "Save")!;
const forms = (sent: Sent[]) => sent.filter(request => request.path === "/api/data-query/metricView/form");
const addressState = (router: ReturnType<typeof createRouter>) => JSON.parse(String(router.currentRoute.value.query.state ?? "{}"));

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("registers what the owners accept: four candidate files, then every projection the panel names and the panel record, from the same sources", () => {
  const files = candidateFiles(SDK_VERSION);
  expect(files.map(file => file.path)).toEqual(["panel.html", "panel.mjs", "recipes.md", "panel.json"]);
  const descriptor = JSON.parse(files.find(file => file.path === "panel.json")!.content);
  expect(Object.keys(descriptor)).toEqual(["manifest", "sdkVersion", "content"]);
  expect(descriptor.sdkVersion).toBe(SDK_VERSION);
  expect(Object.keys(descriptor.content.messages)).toEqual(["en", "zh-CN"]);
  expect(Object.keys(descriptor.content.messages["zh-CN"])).toEqual(Object.keys(descriptor.content.messages.en));

  const material = projectionMaterial();
  expect(Object.keys(material)).toEqual(["projections"]);
  for (const { id, mode, input } of material.projections) {
    expect(mode).toBe("create");
    expect(id).toMatch(/^metric-/);
    productProjectionInputSchema.parse(input);
  }
  // The panel record registers after its projections, under the fixed ID its built-in use relation names.
  const { panels } = panelMaterial(SDK_VERSION);
  expect(panels.map(({ id, mode }) => [id, mode])).toEqual([["metric-views", "create"]]);
  const panel = productPanelInputSchema.parse(panels[0]!.input);
  expect(new Set(material.projections.map(({ id }) => id))).toEqual(new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId)));
  expect(panel.content).toEqual(candidate().panel.content);
  expect(panel.manifest).toEqual(descriptor.manifest);

  // The owner's delete reads its target from the input `metric`, of the metric view type, filled from the selection.
  const remove = material.projections.find(({ id }) => id === manifest.slots.delete!.projectionId)!.input;
  expect(remove.binding).toEqual({ kind: "PlatformOperation", id: DELETE_METRIC_VIEW });
  expect(remove.inputs).toEqual({ metric: { kind: "object", objectType: METRIC_VIEW } });
  expect(manifest.slots.delete!.inputs).toEqual({ metric: { state: "selectedMetric" } });
});

it("lists the owner's metric views with its columns and status labels, and filters them through the owner's client", { timeout: 20000 }, async () => {
  const { app, sent } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    // The panel's words came with the candidate's `panel.json`, in the platform's language.
    expect(titles()).toEqual(["Metric views"]);
    expect([...document.querySelectorAll("#app thead th")].map(cell => cell.textContent?.trim()))
      .toEqual(["Name", "Linked function", "Source", "Status", "Created by", "Last published by", "Last updated"]);
    const first = [...rows()[0]!.querySelectorAll("td")].map(cell => cell.textContent?.trim());
    expect(first.slice(0, 6)).toEqual(["RevenueGross revenue", "calc_revenue", "User", "Published", "Alice", "Bob"]);
    expect(document.querySelector('#app [data-tone="success"]')?.textContent?.trim()).toBe("Published");
    expect(document.querySelector('#app [data-tone="warning"]')?.textContent?.trim()).toBe("Pending review");
    expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("2");
    expect(fieldItem("/name")).toBeNull();
    expect(forms(sent)).toHaveLength(0);

    const search = document.querySelector<HTMLInputElement>("#app input[type=search]")!;
    search.value = "churn";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(rows()).toHaveLength(1), { timeout: 5000 });
    expect(rows()[0]!.textContent).toContain("Churn");
    expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("1");
    // Every request the frame made went out as the reader, marked with the preview's context.
    expect(sent.filter(request => request.path.startsWith("/api/data-query/"))
      .every(request => request.credential === READER && request.execution === BUILD_TEST)).toBe(true);
  } finally {
    app.unmount();
  }
});

it("edits the chosen metric view from the owner's form, deletes only that one, and returns to the list", { timeout: 30000 }, async () => {
  const { app, sent, router, offered } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    rows()[0]!.click();
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("Revenue"), { timeout: 5000 });
    expect(addressState(router)).toEqual({ selectedMetric: { className: METRIC_VIEW, primaryKey: "m1" }, mode: "edit" });
    expect(forms(sent).at(-1)?.body).toEqual({ target: { kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, changedField: null });
    expect(titles()).toEqual(["Definition"]);
    expect(document.querySelector("#app .sdk-section-group-description")?.textContent).toContain("Bindings share");
    expect(rows()).toHaveLength(0);

    // The delete is the owner's operation, labelled by its projection and aimed at the selected metric view.
    expect(deleteButton()?.textContent?.trim()).toBe("Delete metric view");
    expect(deleteButton()?.disabled).toBe(false);
    await vi.waitFor(() => expect(offered.at(-1)?.find(operation => operation.id === "delete.delete")).toMatchObject({
      kind: "action", handlerRef: DELETE_METRIC_VIEW, target: { source: "state", state: "selectedMetric" },
    }));
    expect(offered.at(-1)?.map(operation => operation.id)).toEqual(["definition.save", "delete.delete", "newMetric", "backToList"]);

    document.querySelector<HTMLButtonElement>("#app .metric-views-back")!.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    expect(addressState(router)).toEqual({ mode: "list" });
    expect(fieldItem("/name")).toBeNull();
    expect(deleteButton()).toBeNull();
  } finally {
    app.unmount();
  }
});

it("creates from the owner's draft defaults when the header's new metric view is clicked, and the save is the owner's to refuse in a preview", { timeout: 30000 }, async () => {
  const { app, sent, router, header } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    header("newMetric");
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")).toBeTruthy(), { timeout: 5000 });
    expect(addressState(router)).toEqual({ mode: "create" });
    expect(forms(sent)).toHaveLength(1);
    expect(forms(sent)[0]!.body).toEqual({ target: { kind: "draft" }, changedField: null });
    expect(titles()).toEqual(["New metric view"]);
    expect(deleteButton()).toBeNull();

    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "Net revenue";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    formSave().click();
    // In a candidate preview the save is marked with the workspace's build-test context, and the data engine does not
    // take test-data writes: the refusal is the answer, shown with the form the reader still holds.
    await vi.waitFor(() => expect(document.querySelector("#app .sdk-owner-form")?.textContent).toContain("This interface does not support test data"));
    const saves = sent.filter(request => request.path === "/api/data-query/metricView/save");
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ method: "POST", execution: BUILD_TEST });
    expect(saves[0]!.body).toEqual({ ...defaults, name: "Net revenue" });
    expect(addressState(router)).toEqual({ mode: "create" });
  } finally {
    app.unmount();
  }
});
