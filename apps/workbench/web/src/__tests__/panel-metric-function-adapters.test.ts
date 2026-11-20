import { describe, expect, it } from "vitest";
import { FUNCTION, METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import { functionAdapters } from "../../../../../packages/apps-sdk/src/panel/function";
import { metricViewAdapters } from "../../../../../packages/apps-sdk/src/panel/metric-view";
import { PlatformObjectRefusal, type PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { platformResources } from "../../../../../packages/apps-sdk/src/resources";

/*
 * The metric and function resource adapters against a fake owner: the request paths and bodies they send, the records
 * they map from the owner's asset shape, the owner's labels, and its structured refusal of a form or a save.
 */

interface Sent { path: string; body: unknown; service: string }

function fake(answer: (path: string, body: unknown) => unknown) {
  const sent: Sent[] = [];
  const requests: PlatformRequests = {
    async request(path, init, service) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      sent.push({ path, body, service });
      return Response.json(answer(path, body));
    },
  };
  return { requests, sent };
}

const metric = (id: string, name: string, description: string, status: string, statusLabel: string, origin: string, originLabel: string) => ({
  id, name, description, status, statusLabel, origin, originLabel,
  function: { name: `calc_${id}` },
  createdBy: "u-1", createdByName: "Alice", reviewedBy: "u-2", reviewedByName: "Bob",
  modifyTimestamp: 0,
});

const formDescription = {
  fields: [{ path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false }],
  values: { name: "Revenue" },
  errors: [],
  save: { method: "POST", path: "/metricView/save", bodySchema: {}, draftOperation: "metric-view.update" },
};

describe("metric and function resource adapters", () => {
  it("maps metric records with the owner's labels, tones and localised modified time", async () => {
    const { requests } = fake(() => ({ success: true, data: [
      metric("m1", "Revenue", "Gross revenue", "PUBLISHED", "Published", "USER", "User"),
      { ...metric("m2", "Churn", "Monthly churn", "PENDING_REVIEW", "Pending review", "SYSTEM", "System"), reviewedBy: null, reviewedByName: null },
    ] }));
    const [adapter] = metricViewAdapters(requests);

    const records = await adapter!.list!();

    expect(records[0]).toMatchObject({
      primaryKey: "m1", label: "Revenue", subtitle: "Gross revenue",
      fields: { function: "calc_m1", origin: "User", status: "Published", createdBy: "Alice", reviewedBy: "Bob", modified: new Date(0).toLocaleString() },
      tones: { status: "success" },
    });
    expect(records[1]).toMatchObject({ tones: { status: "warning" }, fields: { origin: "System", status: "Pending review", reviewedBy: "" } });
  });

  it("filters metrics by name and description case-insensitively and reports the filtered total", async () => {
    const { requests } = fake(() => ({ success: true, data: [
      metric("m1", "Revenue", "Gross revenue", "PUBLISHED", "Published", "USER", "User"),
      metric("m2", "Churn", "Monthly churn", "PUBLISHED", "Published", "USER", "User"),
    ] }));
    const [adapter] = metricViewAdapters(requests);

    expect((await adapter!.query!({ search: "GROSS" })).items.map(item => item.primaryKey)).toEqual(["m1"]);
    expect((await adapter!.query!({ search: "monthly" })).items.map(item => item.primaryKey)).toEqual(["m2"]);
    expect((await adapter!.query!({ search: "revenue" })).total).toBe(1);
    expect((await adapter!.query!({ search: "missing" })).total).toBe(0);
    expect((await adapter!.query!({ search: "", page: { limit: 1 } })).total).toBe(2);
  });

  it("reads a single metric through queryById with the owner's display names", async () => {
    const asset = metric("m1", "Revenue", "Gross revenue", "PUBLISHED", "Published", "USER", "User");
    const { requests, sent } = fake(() => ({ success: true, data: asset }));
    const [adapter] = metricViewAdapters(requests);

    const record = await adapter!.read!("m1");

    expect(record.fields).toMatchObject({ status: "Published", origin: "User", createdBy: "Alice", reviewedBy: "Bob" });
    expect(sent[0]).toMatchObject({ path: "/metricView/queryById", body: { id: "m1" } });
  });

  it("turns a metric save the owner refuses at a field into a typed refusal with its field pointers", async () => {
    const message = "Binding 'First': Missing parameter: amount";
    const { requests } = fake(() => ({
      success: false, code: "METRIC_VIEW_BINDING_INVALID", message, errors: [{ field: "/bindings", code: "invalid_object", message }],
    }));
    const [adapter] = metricViewAdapters(requests);
    const save = () => adapter!.forms!.save({ kind: "draft" }, { values: { name: "Revenue" } });

    await expect(save()).rejects.toMatchObject({ name: "PlatformObjectRefusal", message, fields: { "/bindings": message } });
    await expect(save()).rejects.toBeInstanceOf(PlatformObjectRefusal);
  });

  it("parses the owner's form description and sends the complete values to the save", async () => {
    const { requests, sent } = fake(path => path === "/metricView/form"
      ? { success: true, data: formDescription }
      : { success: true, data: { ...metric("m1", "Revenue 2", "", "PUBLISHED", "Published", "USER", "User") } });
    const [adapter] = metricViewAdapters(requests);
    const values = { name: "Revenue 2", description: "", status: "PUBLISHED", function: { name: "calc" }, bindings: [] };

    expect(await adapter!.forms!.describe({ target: { kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, changedField: null }))
      .toEqual(formDescription);
    const saved = await adapter!.forms!.save({ kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, { values });

    expect(saved.primaryKey).toBe("m1");
    expect(sent.find(request => request.path === "/metricView/save")?.body).toEqual({ ...values, id: "m1" });
    expect(sent.every(request => request.service === "/data-query")).toBe(true);
  });

  it("sends the fields a metric or function save submitted with its values", async () => {
    const { requests, sent } = fake(() => ({ success: true, data: metric("m1", "Revenue", "", "PUBLISHED", "Published", "USER", "User") }));
    const [metrics] = metricViewAdapters(requests);
    await metrics!.forms!.save({ kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" },
      { values: { description: "Weekly" }, submittedFields: ["/description"] });
    expect(sent.find(request => request.path === "/metricView/save")?.body)
      .toEqual({ description: "Weekly", id: "m1", submittedFields: ["/description"] });
  });

  it("binds a metric save to its target and refuses another id", async () => {
    const { requests, sent } = fake(() => ({ success: true, data: metric("m1", "Revenue", "", "PUBLISHED", "Published", "USER", "User") }));
    const [adapter] = metricViewAdapters(requests);

    await expect(adapter!.forms!.save({ kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, { values: { id: "m2", name: "Revenue" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", fields: { "/id": "The values name another object" } });
    await expect(adapter!.forms!.save({ kind: "draft" }, { values: { id: "m1", name: "Revenue" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", fields: { "/id": "A new object cannot carry an id" } });
    expect(sent).toHaveLength(0);

    await adapter!.forms!.save({ kind: "object", objectType: METRIC_VIEW, primaryKey: "m1" }, { values: { name: "Revenue" } });
    expect(sent[0]?.body).toEqual({ name: "Revenue", id: "m1" });
    await adapter!.forms!.save({ kind: "draft" }, { values: { name: "Revenue" } });
    expect(sent[1]?.body).toEqual({ name: "Revenue" });
  });

  it("maps function records, filters by name and description, and saves function values", async () => {
    const functions = [
      { id: "f1", name: "Revenue query", description: "Reads revenue", operation: "OPERATION_READ", operationLabel: "Read" },
      { id: "f2", name: "Write order", description: "", operation: "OPERATION_WRITE", operationLabel: "Write" },
    ];
    const { requests, sent } = fake(path => path === "/function/save"
      ? { success: true, data: { id: "f1", name: "Revenue query v2", operation: "OPERATION_READ", operationLabel: "Read" } }
      : { success: true, data: functions });
    const [adapter] = functionAdapters(requests);

    const records = await adapter!.list!();
    expect(records.map(record => record.fields.operation)).toEqual(["Read", "Write"]);
    expect(records[0]).toMatchObject({ primaryKey: "f1", label: "Revenue query", subtitle: "Reads revenue" });
    expect(records[0]).not.toHaveProperty("tones");
    expect((await adapter!.query!({ search: "reads" })).total).toBe(1);
    expect((await adapter!.query!({ search: "ORDER" })).total).toBe(1);

    const saved = await adapter!.forms!.save({ kind: "object", objectType: FUNCTION, primaryKey: "f1" }, { values: { name: "Revenue query v2" } });
    expect(saved.label).toBe("Revenue query v2");
    expect(sent.find(request => request.path === "/function/save")?.body).toEqual({ name: "Revenue query v2", id: "f1" });
  });

  it("binds a function save to its target and refuses another id", async () => {
    const { requests, sent } = fake(() => ({ success: true, data: { id: "f1", name: "Revenue query", operation: "OPERATION_READ", operationLabel: "Read" } }));
    const [adapter] = functionAdapters(requests);

    await expect(adapter!.forms!.save({ kind: "object", objectType: FUNCTION, primaryKey: "f1" }, { values: { id: "f2", name: "Revenue query" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", fields: { "/id": "The values name another object" } });
    await expect(adapter!.forms!.save({ kind: "draft" }, { values: { id: "f1", name: "Revenue query" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", fields: { "/id": "A new object cannot carry an id" } });
    expect(sent).toHaveLength(0);

    await adapter!.forms!.save({ kind: "object", objectType: FUNCTION, primaryKey: "f1" }, { values: { name: "Revenue query" } });
    expect(sent[0]?.body).toEqual({ name: "Revenue query", id: "f1" });
    await adapter!.forms!.save({ kind: "draft" }, { values: { name: "Revenue query" } });
    expect(sent[1]?.body).toEqual({ name: "Revenue query" });
  });

  it("parses the function form description through the function endpoint", async () => {
    const description = {
      ...formDescription,
      errors: [],
      save: { method: "POST", path: "/function/save", bodySchema: {}, draftOperation: "function.create" },
    };
    const { requests, sent } = fake(() => ({ success: true, data: description }));
    const [adapter] = functionAdapters(requests);

    expect(await adapter!.forms!.describe({ target: { kind: "draft" }, changedField: null })).toEqual(description);
    expect(sent[0]).toMatchObject({ path: "/function/form", body: { target: { kind: "draft" }, changedField: null }, service: "/data-query" });
  });

  it("turns a function save the owner refuses at a field into a typed refusal with its field pointers", async () => {
    const message = "Convert this read Function to a query package before saving";
    const { requests } = fake(() => ({
      success: false, code: "FUNCTION_QUERY_PACKAGE_INVALID", message, errors: [{ field: "/queryPackage", code: "invalid_object", message }],
    }));
    const [adapter] = functionAdapters(requests);

    await expect(adapter!.forms!.save({ kind: "draft" }, { values: { name: "Revenue query" } }))
      .rejects.toMatchObject({ name: "PlatformObjectRefusal", message, fields: { "/queryPackage": message } });
  });

  it("registers both adapters in the SDK's resource map", async () => {
    const { requests } = fake(() => ({ success: true, data: [] }));
    const metric = (await platformResources.objects[METRIC_VIEW]!())(requests, (key: string) => key)[0]!;
    const fn = (await platformResources.objects[FUNCTION]!())(requests, (key: string) => key)[0]!;
    expect(metric.objectType).toBe(METRIC_VIEW);
    expect(fn.objectType).toBe(FUNCTION);
  });
});
