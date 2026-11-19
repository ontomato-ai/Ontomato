import { afterEach, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteRecordRaw } from "vue-router";
import type { CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import { DELETE_FUNCTION, FUNCTION } from "@ontomato/contracts/panel-client-requests";
import type { PanelFormDescription, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { productPanelInputSchema, productProjectionInputSchema, type ProductProjection } from "@ontomato/contracts/product-panels";
import { appBuilderPages } from "../../../../../packages/platform-web/src/workbench-routes";
import PanelCandidateRoute from "../../../../../packages/platform-web/src/pages/PanelCandidateRoute.vue";
import {
  candidateFiles, manifest, panelMaterial, projectionMaterial,
} from "../../../../../packages/apps-sdk/examples/panels/functions/material.mjs";
import {
  currentSdk, hostMessageOf, inside, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelHostFrame, READER,
  SDK_VERSION, writeFrameDocument, type Sent,
} from "./panel-frame";

/*
 * The functions panel's candidate, as an author previews it: the workspace files `material.mjs` writes, read through
 * Node's candidate port and shown by the platform's own preview route, panel host, app host and bridge, with the panel's
 * own module running on the SDK's modules in the frame. Only the network is a stand-in: the function owner answers its
 * list, its form and its refusal of a build-test write as the data engine does.
 *
 * What this rules out: a list that drops the owner's operation labels, or filters in the panel; a mode that does not
 * follow the selection; a form read from anywhere but the owner's form for the chosen target, or a rule about which
 * functions may change written into the panel; a create that does not start from the owner's draft; a delete aimed at
 * anything but the selected function under the input name the owner's operation reads; and a candidate that saves live.
 */

const WORKSPACE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const previewPath = `/app-builder/${WORKSPACE}/panel-preview/working/functions`;
const BUILD_TEST = JSON.stringify({ kind: "build-test", contextId: null });
const IN_USE = "This function is used by a metric view and cannot be changed or deleted";

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

/** The function owner's assets, as `/function/queryList` gives them: a read function in use and a write function. */
const assets: (PanelFormValues & { id: string; operationLabel: string })[] = [
  {
    id: "f1", name: "calc_revenue", description: "Revenue by period", operation: "OPERATION_READ", operationLabel: "Read",
    origin: "USER", logic: "", queryPackage: { manifest: { parameterDefs: [] } }, returnDef: { columnLabels: {} },
  },
  {
    id: "f2", name: "close_order", description: "Closes an order", operation: "OPERATION_WRITE", operationLabel: "Write",
    origin: "USER", logic: "", parameters: [{ name: "orderId", type: "string" }], returnDef: { classNames: ["Order"] }, code: "def run(orderId): ...",
  },
];
const stored = (id: string): PanelFormValues => {
  const { operationLabel: _label, ...values } = assets.find(asset => asset.id === id)!;
  return values;
};
const defaults: PanelFormValues = {
  name: "", description: "", origin: "USER", operation: "OPERATION_READ", parameters: [],
  returnDef: { isVoid: false, outKeyRefs: [], value: {}, classNames: [] }, code: "", logic: "",
};

const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });
const field = (path: string, label: string, control: PanelFormDescription["fields"][number]["control"], more = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: false, ...more });
/**
 * The function owner's form, as `/function/form` describes it: the fields follow the operation type, which is locked once
 * saved, and a function in use is read-only throughout with the owner's reason.
 */
function fieldsFor(values: PanelFormValues, existing: boolean): PanelFormDescription["fields"] {
  const reason = values.id === "f1" ? IN_USE : undefined;
  const inUse = reason ? { readOnly: true, readOnlyReason: reason } : {};
  const operationReason = reason ?? (existing ? "The operation type cannot change once saved" : undefined);
  const operation = operationReason ? { readOnly: true, readOnlyReason: operationReason } : {};
  const kind = values.operation === "OPERATION_WRITE"
    ? [
      field("/parameters", "Parameters", { kind: "object-array", itemFields: [field("/name", "Name", { kind: "text" })] }, inUse),
      field("/returnDef/classNames", "Return classes", { kind: "string-array" }, inUse),
    ]
    : [
      field("/queryPackage", "Query package", { kind: "code", language: "json" }, { required: true, ...inUse }),
      field("/returnDef/columnLabels", "Column labels", { kind: "code", language: "json" }, inUse),
    ];
  return [
    field("/name", "Name", { kind: "text" }, { required: true, ...inUse }),
    field("/description", "Description", { kind: "text", multiline: true }, inUse),
    field("/operation", "Operation type", { kind: "select", options: [option("OPERATION_READ", "Read"), option("OPERATION_WRITE", "Write")] },
      { refreshOnChange: true, ...inUse, ...operation }),
    ...kind,
    field("/logic", "Logic", { kind: "text", multiline: true }, inUse),
    ...(values.operation === "OPERATION_WRITE" ? [field("/code", "Code", { kind: "code", language: "python" }, inUse)] : []),
  ];
}
const save = (create: boolean) => ({
  method: "POST" as const, path: "/function/save", bodySchema: {}, draftOperation: create ? "function.create" : "function.update",
});
const owned = (data: unknown) => Response.json({ success: true, data });

/** Node's candidate port and the function owner, as they answer the preview. */
function owners(request: Sent): Response {
  if (request.path === `/api/workspaces/${WORKSPACE}/panel-candidate`) return Response.json(candidate());
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  if (request.path === "/api/product-panels/definition-stream")
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  const projected = /^\/api\/product-projections\/(.+)$/.exec(request.path);
  if (projected) return Response.json({ projection: projections[projected[1]!] });
  // The data engine's build-test guard refuses a save, which declares no test-data access, before the owner runs.
  if (request.path === "/api/data-query/function/save" && request.execution)
    return Response.json({ success: false, code: "BUILD_TEST_UNSUPPORTED", message: "This interface does not support test data" }, { status: 422 });
  if (request.path === "/api/data-query/function/queryList") return owned(assets);
  if (request.path === "/api/data-query/function/form") {
    const { target, values: given } = request.body as { target: { kind: string; primaryKey?: string }; values?: PanelFormValues };
    const create = target.kind === "draft";
    const values = given ?? (create ? defaults : stored(target.primaryKey!));
    return owned({ fields: fieldsFor(values, !create), values, save: save(create) });
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
  await import("../../../../../packages/apps-sdk/examples/panels/functions/panel.mjs");
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
const forms = (sent: Sent[]) => sent.filter(request => request.path === "/api/data-query/function/form");
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
    expect(id).toMatch(/^function-/);
    productProjectionInputSchema.parse(input);
  }
  // The panel record registers after its projections, under the fixed ID its built-in use relation names.
  const { panels } = panelMaterial(SDK_VERSION);
  expect(panels.map(({ id, mode }) => [id, mode])).toEqual([["functions", "create"]]);
  const panel = productPanelInputSchema.parse(panels[0]!.input);
  expect(new Set(material.projections.map(({ id }) => id))).toEqual(new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId)));
  expect(panel.content).toEqual(candidate().panel.content);
  expect(panel.manifest).toEqual(descriptor.manifest);

  // The owner's delete reads its target from the input `function`, of the function type, filled from the selection.
  const remove = material.projections.find(({ id }) => id === manifest.slots.delete!.projectionId)!.input;
  expect(remove.binding).toEqual({ kind: "PlatformOperation", id: DELETE_FUNCTION });
  expect(remove.inputs).toEqual({ function: { kind: "object", objectType: FUNCTION } });
  expect(manifest.slots.delete!.inputs).toEqual({ function: { state: "selectedFunction" } });
});

it("lists the owner's functions with their operation types, and filters them through the owner's client", { timeout: 20000 }, async () => {
  const { app, sent } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    expect(titles()).toEqual(["Functions"]);
    expect([...document.querySelectorAll("#app thead th")].map(cell => cell.textContent?.trim())).toEqual(["Name", "Operation type"]);
    expect(rows().map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent?.trim()))).toEqual([
      ["calc_revenueRevenue by period", "Read"], ["close_orderCloses an order", "Write"],
    ]);
    expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("2");
    expect(forms(sent)).toHaveLength(0);

    const search = document.querySelector<HTMLInputElement>("#app input[type=search]")!;
    search.value = "ORDER";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(rows()).toHaveLength(1), { timeout: 5000 });
    expect(rows()[0]!.textContent).toContain("close_order");
    expect(document.querySelector("#app .sdk-object-list-count")?.textContent).toContain("1");
    expect(sent.filter(request => request.path.startsWith("/api/data-query/"))
      .every(request => request.credential === READER && request.execution === BUILD_TEST)).toBe(true);
  } finally {
    app.unmount();
  }
});

it("edits the chosen function as its owner allows, deletes only that one, and returns to the list", { timeout: 30000 }, async () => {
  const { app, sent, router, offered } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    rows()[0]!.click();
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("calc_revenue"), { timeout: 5000 });
    expect(addressState(router)).toEqual({ selectedFunction: { className: FUNCTION, primaryKey: "f1" }, mode: "edit" });
    expect(forms(sent).at(-1)?.body).toEqual({ target: { kind: "object", objectType: FUNCTION, primaryKey: "f1" }, changedField: null });
    expect(titles()).toEqual(["Definition"]);
    // A function in use is the owner's to lock: the form shows it read-only with the owner's reason.
    expect(fieldItem("/name")?.querySelector("input")?.disabled).toBe(true);
    expect(fieldItem("/name")?.textContent).toContain(IN_USE);

    expect(deleteButton()?.textContent?.trim()).toBe("Delete function");
    expect(deleteButton()?.disabled).toBe(false);
    await vi.waitFor(() => expect(offered.at(-1)?.find(operation => operation.id === "delete.delete")).toMatchObject({
      kind: "action", handlerRef: DELETE_FUNCTION, target: { source: "state", state: "selectedFunction" },
    }));
    expect(offered.at(-1)?.map(operation => operation.id)).toEqual(["definition.save", "delete.delete", "newFunction", "backToList"]);

    document.querySelector<HTMLButtonElement>("#app .functions-back")!.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    expect(addressState(router)).toEqual({ mode: "list" });

    // Another function, one not in use: only its operation type is locked.
    rows()[1]!.click();
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")?.value).toBe("close_order"), { timeout: 5000 });
    expect(addressState(router)).toEqual({ selectedFunction: { className: FUNCTION, primaryKey: "f2" }, mode: "edit" });
    expect(fieldItem("/name")?.querySelector("input")?.disabled).toBe(false);
    expect(fieldItem("/operation")?.textContent).toContain("The operation type cannot change once saved");
  } finally {
    app.unmount();
  }
});

it("creates from the owner's draft defaults when the header's new function is clicked, and the save is the owner's to refuse in a preview", { timeout: 30000 }, async () => {
  const { app, sent, router, header } = await preview({});
  try {
    await vi.waitFor(() => expect(rows()).toHaveLength(2), { timeout: 5000 });
    header("newFunction");
    await vi.waitFor(() => expect(fieldItem("/name")?.querySelector("input")).toBeTruthy(), { timeout: 5000 });
    expect(addressState(router)).toEqual({ mode: "create" });
    expect(forms(sent)).toHaveLength(1);
    expect(forms(sent)[0]!.body).toEqual({ target: { kind: "draft" }, changedField: null });
    expect(titles()).toEqual(["New function"]);
    expect(deleteButton()).toBeNull();

    const name = fieldItem("/name")!.querySelector("input")!;
    name.value = "calc_margin";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    formSave().click();
    await vi.waitFor(() => expect(document.querySelector("#app .sdk-owner-form")?.textContent).toContain("This interface does not support test data"));
    const saves = sent.filter(request => request.path === "/api/data-query/function/save");
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ method: "POST", execution: BUILD_TEST });
    expect(saves[0]!.body).toEqual({ ...defaults, name: "calc_margin" });
  } finally {
    app.unmount();
  }
});
