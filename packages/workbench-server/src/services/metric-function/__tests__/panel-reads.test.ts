import { afterEach, expect, it, vi } from "vitest";
import { dashboardMetricOutputSchema } from "@ontomato/contracts/dashboard";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { createFunctionReadAdapter, createMetricReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

/*
 * The metric and function reads. The catalogue reads ask the data-query owner as the reader and answer records with
 * this owner's column names and the owner's form for a saved or a new definition; a refusal keeps the owner's code. The
 * metric result read: the reader's credentials and language reach the owner, the metric runs at the revision its
 * description names with the named parameter values (a chosen object by its primary key), the owner's output comes back
 * as it is, and the owner's refusals stay the owner's, with its status and words.
 */

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "zh-CN" };
const description = {
  id: "m1", revision: "rev-7", status: "PUBLISHED", name: "Revenue by customer",
  parameterDefs: [{ name: "customerId", type: "TYPE_STRING" }, { name: "year", type: "TYPE_NUMBER" }],
  outputColumns: [{ key: "month", label: "Month", type: null }, { key: "revenue", label: "Revenue", type: null }],
  sourceObjectTypes: ["Order"],
};
const output = {
  columns: description.outputColumns,
  rows: [{ month: "2026-01", revenue: 120 }, { month: "2026-02", revenue: 95 }],
  truncation: { truncated: true, rowLimit: 2, truncationHint: "Narrow the date range" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function ownerAnswering(execute: (body: Record<string, unknown>) => Response) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    expect(headers.get("tk")).toBe(viewer.token);
    expect(headers.get("Accept-Language")).toBe(viewer.locale);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ path, body });
    if (init.method === "POST" && path === "/ontology/query/metrics/describe") return Response.json(description);
    if (init.method === "POST" && path === "/ontology/query/metrics/execute") return execute(body);
    throw new Error(`Unexpected owner request ${init.method} ${path}`);
  }));
  return sent;
}

it("runs the selected metric as the reader at its described revision and answers the owner's output", async () => {
  const sent = ownerAnswering(() => Response.json(output));

  const result = await createMetricReadAdapter(owner, viewer).result("m1", {
    customerId: { className: "Customer", primaryKey: "c-42" }, year: 2026,
  });

  expect(dashboardMetricOutputSchema.parse(result)).toEqual(output);
  expect(sent).toEqual([
    { path: "/ontology/query/metrics/describe", body: { id: "m1" } },
    { path: "/ontology/query/metrics/execute", body: { id: "m1", revision: "rev-7", parameters: { customerId: "c-42", year: 2026 } } },
  ]);
});

it("fills a list parameter from a checked list of objects with their keys in order", async () => {
  const sent = ownerAnswering(() => Response.json(output));

  await createMetricReadAdapter(owner, viewer).result("m1", {
    customerIds: [{ className: "Customer", primaryKey: "c-42" }, { className: "Customer", primaryKey: "c-7" }],
    regions: ["east", "west"],
  });

  expect(sent[1]?.body).toEqual({
    id: "m1", revision: "rev-7", parameters: { customerIds: ["c-42", "c-7"], regions: ["east", "west"] },
  });
});

it("runs a metric without parameters with none", async () => {
  const sent = ownerAnswering(() => Response.json({ ...output, rows: [], truncation: null }));

  expect(await createMetricReadAdapter(owner, viewer).result("m1", {}))
    .toEqual({ columns: description.outputColumns, rows: [], truncation: null });
  expect(sent[1]?.body).toEqual({ id: "m1", revision: "rev-7", parameters: {} });
});

it("keeps the owner's refusal with its status and words, and runs a failed metric once", async () => {
  const cases: [number, string][] = [
    [400, "Missing parameter: customerId"],
    [403, "Field is outside the authorized scope"],
    [404, "Executable read metric not found"],
    [409, "Metric specification changed; retrieve it again"],
    [500, "Python execution failed"],
  ];
  for (const [status, message] of cases) {
    const sent = ownerAnswering(() => Response.json({ error: { code: "ONTOLOGY_QUERY_FAILED", message } }, { status }));

    const refusal = await createMetricReadAdapter(owner, viewer).result("m1", { year: 2026 }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal).toMatchObject({ status, message });
    expect(sent.filter(request => request.path.endsWith("/execute"))).toHaveLength(1);
    vi.unstubAllGlobals();
  }
});

const metricAsset = {
  id: "m1", name: "Revenue by customer", description: "Monthly revenue", status: "PUBLISHED", statusLabel: "已发布",
  origin: "USER", originLabel: "用户", createdByName: "Alice", reviewedByName: "Bob",
  function: { id: "f1", name: "revenue_query" }, modifyTimestamp: Date.UTC(2026, 10, 20, 8, 30),
};
const functionAsset = { id: "f1", name: "revenue_query", description: "", operation: "OPERATION_READ", operationLabel: "读" };
const formDescription = {
  fields: [{ path: "/name", label: "名称", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }],
  values: { name: "Revenue by customer" }, errors: [],
  save: { method: "POST", path: "/metricView/save", bodySchema: {}, draftOperation: "metric-view.update" },
};

/** A data-query owner answering in its envelope; `answer` gives the data for a path, or a whole envelope to send. */
function catalogueOwner(answer: (path: string, body: Record<string, unknown>) => unknown) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    expect(headers.get("tk")).toBe(viewer.token);
    expect(headers.get("Accept-Language")).toBe(viewer.locale);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ path, body });
    return Response.json(answer(path, body));
  }));
  return sent;
}

it("reads the metric catalogue as records with the owner's labels and this owner's column names", async () => {
  const sent = catalogueOwner(path => ({ success: true, data: path.endsWith("/queryList") ? [metricAsset] : metricAsset }));
  const reads = createMetricReadAdapter(owner, viewer);

  const { rows: [row], total } = panelReadResultSchemas.panelRecordQuery.parse(await reads.query({}));
  const record = panelReadResultSchemas.panelRecord.parse(await reads.record("m1"));

  expect(row).toEqual(record);
  expect(total).toBe(1);
  expect(record).toEqual({
    primaryKey: "m1", label: "Revenue by customer", subtitle: "Monthly revenue",
    fields: {
      function: "revenue_query", origin: "用户", status: "已发布", createdBy: "Alice", reviewedBy: "Bob",
      modified: "2026-11-20T08:30:00.000Z",
    },
    fieldLabels: {
      function: "Function", origin: "Origin", status: "Status", createdBy: "Created by", reviewedBy: "Reviewed by",
      modified: "Updated",
    },
    tones: { status: "success" },
  });
  expect(sent).toEqual([
    { path: "/metricView/queryList", body: {} },
    { path: "/metricView/queryById", body: { id: "m1" } },
  ]);
});

it("reads the function catalogue with the owner's operation label", async () => {
  const sent = catalogueOwner(path => ({ success: true, data: path.endsWith("/queryList") ? [functionAsset] : functionAsset }));
  const reads = createFunctionReadAdapter(owner, viewer);

  expect(panelReadResultSchemas.panelRecordQuery.parse(await reads.query({}))).toEqual({ rows: [{
    primaryKey: "f1", label: "revenue_query", fields: { operation: "读" }, fieldLabels: { operation: "Operation" },
  }], total: 1 });
  expect(await reads.record("f1")).toEqual({
    primaryKey: "f1", label: "revenue_query", fields: { operation: "读" }, fieldLabels: { operation: "Operation" },
  });
  expect(sent).toEqual([
    { path: "/function/queryList", body: {} },
    { path: "/function/queryById", body: { id: "f1" } },
  ]);
});

it("asks the owner's form for a saved or a new definition, with the values to check or recompute", async () => {
  const sent = catalogueOwner(() => ({ success: true, data: formDescription }));
  const metrics = createMetricReadAdapter(owner, viewer);
  const functions = createFunctionReadAdapter(owner, viewer);

  expect(panelReadResultSchemas.panelFormDescription.parse(await metrics.form("m1", {}))).toEqual(formDescription);
  await metrics.form("m1", { values: { name: "Draft" }, changedField: "/function/queryPackage" });
  await metrics.createForm({ values: { name: "New" } });
  await functions.form("f1", {});
  await functions.createForm({});

  expect(sent).toEqual([
    { path: "/metricView/form", body: { target: { kind: "object", objectType: "platform:MetricView", primaryKey: "m1" }, changedField: null } },
    { path: "/metricView/form", body: {
      target: { kind: "object", objectType: "platform:MetricView", primaryKey: "m1" },
      values: { name: "Draft" }, changedField: "/function/queryPackage",
    } },
    { path: "/metricView/form", body: { target: { kind: "draft" }, values: { name: "New" }, changedField: null } },
    { path: "/function/form", body: { target: { kind: "object", objectType: "platform:Function", primaryKey: "f1" }, changedField: null } },
    { path: "/function/form", body: { target: { kind: "draft" }, changedField: null } },
  ]);
});

it("keeps the owner's read refusal with its code: a missing definition is missing, an uncoded failure fails", async () => {
  catalogueOwner(path => path.endsWith("/queryById")
    ? { success: false, code: "FUNCTION_NOT_FOUND", message: "Function not found" }
    : { success: false, message: "The definition store is unavailable" });
  const functions = createFunctionReadAdapter(owner, viewer);

  await expect(functions.record("gone")).rejects.toMatchObject({ status: 404, code: "FUNCTION_NOT_FOUND", message: "Function not found" });
  await expect(functions.query({})).rejects.toMatchObject({
    status: 500, code: "FUNCTION_READ_FAILED", message: "The definition store is unavailable",
  });
  await expect(functions.query({})).rejects.toBeInstanceOf(HttpError);
});

it("searches a catalogue by name or description in any case and pages what it keeps by an offset cursor", async () => {
  const metrics = ["Revenue", "Orders", "Refunds", "Net revenue"].map((name, index) => ({
    ...metricAsset, id: `m${index}`, name, description: index === 1 ? "Counts REVENUE orders" : "",
  }));
  catalogueOwner(() => ({ success: true, data: metrics }));
  const reads = createMetricReadAdapter(owner, viewer);
  const keys = (query: { rows: { primaryKey: string }[] }) => query.rows.map(row => row.primaryKey);

  const first = await reads.query({ search: " revenue ", size: 2 });
  expect(keys(first)).toEqual(["m0", "m1"]);
  expect(first).toMatchObject({ nextCursor: "2", total: 3 });
  const second = await reads.query({ search: "revenue", cursor: first.nextCursor, size: 2 });
  expect(keys(second)).toEqual(["m3"]);
  expect(second).not.toHaveProperty("nextCursor");
  expect(keys(await reads.query({}))).toEqual(["m0", "m1", "m2", "m3"]);
  for (const cursor of ["later", "", " ", "0x10", "1e2", "-1", "1.5"])
    await expect(reads.query({ cursor })).rejects.toMatchObject({ status: 400, code: "INVALID_CURSOR" });
});

it("forwards metric status/origin filters and function operation filter to their owners", async () => {
  const sent = catalogueOwner(path => ({ success: true, data: path.endsWith("/metricView/queryList") ? [metricAsset] : [functionAsset] }));
  const metrics = createMetricReadAdapter(owner, viewer);
  const functions = createFunctionReadAdapter(owner, viewer);

  await metrics.query({ status: "PUBLISHED", origin: "USER" });
  await metrics.query({ status: "UNUSED" });
  await functions.query({ operation: "OPERATION_PRODUCT" });

  expect(sent).toEqual([
    { path: "/metricView/queryList", body: { status: "PUBLISHED", origin: "USER" } },
    { path: "/metricView/queryList", body: { status: "UNUSED" } },
    { path: "/function/queryList", body: { operation: "OPERATION_PRODUCT" } },
  ]);
  await expect(metrics.query({ status: "UNKNOWN" })).rejects.toThrow();
  await expect(metrics.query({ origin: "OTHER" })).rejects.toThrow();
  await expect(functions.query({ operation: "OPERATION_OTHER" })).rejects.toThrow();
});
