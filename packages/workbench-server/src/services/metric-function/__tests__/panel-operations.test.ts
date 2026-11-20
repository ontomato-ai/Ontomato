import { describe, expect, it } from "vitest";
import {
  DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW, SET_METRIC_VIEW_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m5ServerOperations } from "../panel-operations";

/*
 * The metric and function server operations: their target shapes, the data-query requests they send, the success
 * data they return with what changed, the owner's business refusals as refusals, the delete label read, the deletion
 * impact the host confirms with, the publication-status change, and the two read-only trials of a metric draft.
 */

// The impact descriptions read their localized summaries through the installed English pack.
configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

type M5Operation = (typeof m5ServerOperations)[number];
const write = (handlerRef: string) =>
  m5ServerOperations.find((item): item is Extract<M5Operation, { effect: "write" }> =>
    item.effect === "write" && item.handlerRef === handlerRef)!;
const action = (handlerRef: string) =>
  m5ServerOperations.find((item): item is Extract<M5Operation, { effect: "write"; kind: "action"; batch: false }> =>
    item.effect === "write" && item.kind === "action" && item.batch === false && item.handlerRef === handlerRef)!;
const batchAction = (handlerRef: string) =>
  m5ServerOperations.find((item): item is Extract<M5Operation, { effect: "write"; kind: "action"; batch: true }> =>
    item.effect === "write" && item.kind === "action" && item.batch === true && item.handlerRef === handlerRef)!;
const read = (handlerRef: string) =>
  m5ServerOperations.find((item): item is Extract<M5Operation, { effect: "read" }> =>
    item.effect === "read" && item.handlerRef === handlerRef)!;

const actor = { owner: { domainId: "d", userId: "U" }, credentials: { token: "U-token", locale: "en" } };

function hostWith(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => Response) {
  const sent: { path: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = [];
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    async request(path, init) {
      sent.push({ path, init });
      return answer(path, init);
    },
    async requestWorkbench() {
      throw new Error("The metric and function owners do not use the workbench request");
    },
  };
  return { host, sent };
}

const metricTarget = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m1" };
const functionTarget = { kind: "object" as const, objectType: FUNCTION, primaryKey: "f1" };

describe("metric and function panel server operations", () => {
  it("declares the metric save target, draft operation and create identity", () => {
    const operation = write(`${METRIC_VIEW}.save`);
    expect(operation.kind).toBe("form.save");
    if (operation.kind !== "form.save") throw new Error("not a form save");
    expect(operation.binding).toEqual({ kind: "PlatformObjectType", id: METRIC_VIEW });
    expect(operation.targetSchema.safeParse(metricTarget).success).toBe(true);
    expect(operation.targetSchema.safeParse({ ...metricTarget, objectType: FUNCTION }).success).toBe(false);
    expect(operation.targetSchema.safeParse({ kind: "draft" }).success).toBe(true);
    expect(operation.draftOperation(metricTarget)).toBe("metric-view.update");
    expect(operation.draftOperation({ kind: "draft" })).toBe("metric-view.create");
    expect(operation.create?.createdObject({ id: "created" })).toEqual({ objectType: METRIC_VIEW, primaryKey: "created" });
  });

  it("sends the complete metric values and returns the saved asset", async () => {
    const operation = write(`${METRIC_VIEW}.save`);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { id: "m1", name: "Revenue 2" } }));

    const outcome = await operation.execute(host, metricTarget, { values: { name: "Revenue 2", bindings: [] } });

    expect(outcome).toEqual({
      kind: "success", data: { id: "m1", name: "Revenue 2" },
      affected: { objects: [{ objectType: METRIC_VIEW, primaryKey: "m1" }], objectTypes: [METRIC_VIEW, FUNCTION] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/metricView/save");
    expect(sent[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ name: "Revenue 2", bindings: [], id: "m1" });
  });

  it("binds a metric save to its target and refuses another id", async () => {
    const operation = write(`${METRIC_VIEW}.save`);
    const rejected = hostWith(() => Response.json({ success: true, data: { id: "m1", name: "Revenue" } }));
    await expect(operation.execute(rejected.host, metricTarget, { values: { id: "m2", name: "Revenue" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    await expect(operation.execute(rejected.host, { kind: "draft" }, { values: { id: "m1", name: "Revenue" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    expect(rejected.sent).toHaveLength(0);

    const updated = hostWith(() => Response.json({ success: true, data: { id: "m1", name: "Revenue" } }));
    await operation.execute(updated.host, metricTarget, { values: { name: "Revenue" } });
    expect(JSON.parse(String(updated.sent[0]?.init.body))).toEqual({ name: "Revenue", id: "m1" });

    const created = hostWith(() => Response.json({ success: true, data: { id: "m-new", name: "Revenue" } }));
    await operation.execute(created.host, { kind: "draft" }, { values: { name: "Revenue" } });
    expect(JSON.parse(String(created.sent[0]?.init.body))).toEqual({ name: "Revenue" });
  });

  it("turns a metric owner refusal into a refusal", async () => {
    const operation = write(`${METRIC_VIEW}.save`);
    const { host } = hostWith(() => Response.json({
      success: false, code: "METRIC_VIEW_SYSTEM_READONLY", message: "Cannot modify a system MetricView",
    }));

    expect(await operation.execute(host, metricTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_SYSTEM_READONLY", message: "Cannot modify a system MetricView" });
  });

  it("keeps the owner's field errors on a metric or function save it refuses at a field", async () => {
    const error = { field: "/bindings", code: "invalid_object", message: "Binding 'First': Missing parameter: amount" };
    const metric = hostWith(() => Response.json({
      success: false, code: "METRIC_VIEW_BINDING_INVALID", message: error.message, errors: [error],
    }));
    expect(await write(`${METRIC_VIEW}.save`).execute(metric.host, metricTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_BINDING_INVALID", message: error.message, errors: [error] });

    const packageError = { field: "/queryPackage", code: "invalid_object", message: "Convert this read Function to a query package before saving" };
    const fn = hostWith(() => Response.json({
      success: false, code: "FUNCTION_QUERY_PACKAGE_INVALID", message: packageError.message, errors: [packageError],
    }));
    expect(await write(`${FUNCTION}.save`).execute(fn.host, { kind: "draft" }, { values: { name: "Revenue query" } }))
      .toEqual({ kind: "refusal", code: "FUNCTION_QUERY_PACKAGE_INVALID", message: packageError.message, errors: [packageError] });
  });

  it("keeps an uncoded write error as a known failure", async () => {
    const operation = write(`${METRIC_VIEW}.save`);
    const { host } = hostWith(() => Response.json({ success: false, message: "The definition store could not complete the write" }));

    expect(await operation.execute(host, metricTarget, { values: {} }))
      .toEqual({ kind: "failure", code: "METRIC_VIEW_SAVE_FAILED", message: "The definition store could not complete the write" });
  });

  it("reads the metric label and deletes by id", async () => {
    const operation = action(DELETE_METRIC_VIEW);
    expect(operation.kind).toBe("action");
    expect(operation.targetSchema.safeParse({ kind: "draft" }).success).toBe(false);
    const label = hostWith(path => path.endsWith("/metricView/queryById")
      ? Response.json({ success: true, data: { name: "Revenue" } })
      : Response.json({ success: true }));
    expect(await operation.targetLabel(label.host, metricTarget)).toBe("Revenue");
    expect(JSON.parse(String(label.sent[0]?.init.body))).toEqual({ id: "m1" });

    const remove = hostWith(() => Response.json({ success: true }));
    expect(await operation.execute(remove.host, metricTarget)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: METRIC_VIEW, primaryKey: metricTarget.primaryKey }], objectTypes: [METRIC_VIEW] },
    });
    expect(remove.sent[0]?.path).toBe("/api/data-query/metricView/delete");
    expect(JSON.parse(String(remove.sent[0]?.init.body))).toEqual({ id: "m1" });

    const refused = hostWith(() => Response.json({
      success: false, code: "METRIC_VIEW_SYSTEM_READONLY", message: "Cannot delete a system MetricView",
    }));
    expect(await operation.execute(refused.host, metricTarget))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_SYSTEM_READONLY", message: "Cannot delete a system MetricView" });
  });

  it("fails the metric label read with the owner's reason", async () => {
    const operation = action(DELETE_METRIC_VIEW);
    const missing = hostWith(() => Response.json({ success: false, message: "MetricView not found" }));
    await expect(operation.targetLabel(missing.host, metricTarget))
      .rejects.toMatchObject({ status: 404, message: "MetricView not found", code: "METRIC_VIEW_UNAVAILABLE" });
    const outage = hostWith(() => Response.json({ message: "Owner unavailable" }, { status: 503 }));
    await expect(operation.targetLabel(outage.host, metricTarget))
      .rejects.toMatchObject({ status: 503, message: "Owner unavailable", code: "METRIC_VIEW_UNAVAILABLE" });
  });

  it("describes the metric delete impact with the bindings it takes along", async () => {
    const operation = action(DELETE_METRIC_VIEW);
    const { host, sent } = hostWith(() =>
      Response.json({ success: true, data: { name: "Revenue", bindings: [{ chartId: "c1" }, { chartId: "c2" }] } }));
    expect(await operation.inspectImpact!.inspect({ ...host, locale: "en" }, [{ target: metricTarget, input: {} }])).toEqual({
      summary: "This deletes the selected metric, together with its bindings (2 in total).",
      objects: [{ target: { objectType: METRIC_VIEW, primaryKey: "m1" }, label: "Revenue" }],
      total: 1,
    });
    expect(sent[0]?.path).toBe("/api/data-query/metricView/queryById");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ id: "m1" });
  });

  it("fails the metric delete impact with the owner's reason", async () => {
    const operation = action(DELETE_METRIC_VIEW);
    const missing = hostWith(() => Response.json({ success: false, message: "MetricView not found" }));
    await expect(operation.inspectImpact!.inspect(missing.host, [{ target: metricTarget, input: {} }]))
      .rejects.toMatchObject({ status: 404, message: "MetricView not found", code: "METRIC_VIEW_UNAVAILABLE" });
    const outage = hostWith(() => Response.json({ message: "Owner unavailable" }, { status: 503 }));
    await expect(operation.inspectImpact!.inspect(outage.host, [{ target: metricTarget, input: {} }]))
      .rejects.toMatchObject({ status: 503, message: "Owner unavailable", code: "METRIC_VIEW_UNAVAILABLE" });
  });

  it("changes one metric's publication status and returns the saved metric", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const labelled = hostWith(path => path.endsWith("/metricView/queryById")
      ? Response.json({ success: true, data: { name: "Revenue" } })
      : Response.json({ success: true, data: { items: [
        { id: "m1", outcome: "success", data: { id: "m1", name: "Revenue", status: "PUBLISHED" } },
      ] } }));
    expect(await operation.targetLabel(labelled.host, metricTarget)).toBe("Revenue");

    const changed = hostWith(() => Response.json({ success: true, data: { items: [
      { id: "m1", outcome: "success", data: { id: "m1", name: "Revenue", status: "PUBLISHED" } },
    ] } }));
    expect(await operation.execute(changed.host, metricTarget, { status: "PUBLISHED" })).toEqual({
      kind: "success", data: { id: "m1", name: "Revenue", status: "PUBLISHED" },
      affected: { objects: [{ objectType: METRIC_VIEW, primaryKey: "m1" }], objectTypes: [METRIC_VIEW] },
    });
    expect(changed.sent[0]?.path).toBe("/api/data-query/metricView/setStatus");
    expect(JSON.parse(String(changed.sent[0]?.init.body))).toEqual({ ids: ["m1"], status: "PUBLISHED" });
  });

  it("tells one metric's coded refusal from its uncoded failure", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const refused = hostWith(() => Response.json({ success: true, data: { items: [
      { id: "m1", outcome: "refusal", code: "METRIC_VIEW_SYSTEM", error: { message: "Cannot modify a system MetricView" } },
    ] } }));
    expect(await operation.execute(refused.host, metricTarget, { status: "UNUSED" }))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_SYSTEM", message: "Cannot modify a system MetricView" });
    const failed = hostWith(() => Response.json({ success: true, data: { items: [
      { id: "m1", outcome: "failure", error: { message: "connection reset" } },
    ] } }));
    expect(await operation.execute(failed.host, metricTarget, { status: "UNUSED" }))
      .toEqual({ kind: "failure", code: "METRIC_VIEW_STATUS_FAILED", message: "connection reset" });
  });

  it("answers each call of a status batch by its metric, in the calls' order", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const secondMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m2" };
    const thirdMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m3" };
    const answered = hostWith(() => Response.json({ success: true, data: { items: [
      { id: "m2", outcome: "success", data: { id: "m2", status: "PENDING_REVIEW" } },
      { id: "m3", outcome: "failure", error: { message: "connection reset" } },
      { id: "m1", outcome: "refusal", code: "METRIC_VIEW_SYSTEM", error: { message: "Cannot modify a system MetricView" } },
    ] } }));
    expect(await operation.executeBatch(answered.host, [
      { target: metricTarget, input: { status: "PENDING_REVIEW" } },
      { target: secondMetric, input: { status: "PENDING_REVIEW" } },
      { target: thirdMetric, input: { status: "PENDING_REVIEW" } },
    ])).toEqual({
      kind: "batch",
      items: [
        { target: { objectType: METRIC_VIEW, primaryKey: "m1" },
          outcome: { kind: "refusal", code: "METRIC_VIEW_SYSTEM", message: "Cannot modify a system MetricView" } },
        { target: { objectType: METRIC_VIEW, primaryKey: "m2" },
          outcome: { kind: "success", data: { id: "m2", status: "PENDING_REVIEW" },
            affected: { objects: [{ objectType: METRIC_VIEW, primaryKey: "m2" }], objectTypes: [METRIC_VIEW] } } },
        { target: { objectType: METRIC_VIEW, primaryKey: "m3" },
          outcome: { kind: "failure", code: "METRIC_VIEW_STATUS_FAILED", message: "connection reset" } },
      ],
    });
    expect(JSON.parse(String(answered.sent[0]?.init.body))).toEqual({ ids: ["m1", "m2", "m3"], status: "PENDING_REVIEW" });
  });

  it("sends a status batch whose calls name different statuses as one owner request per status", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const secondMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m2" };
    const thirdMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m3" };
    const grouped = hostWith((_path, init) => {
      const { ids, status } = JSON.parse(String(init.body)) as { ids: string[]; status: string };
      return Response.json({ success: true, data: { items: ids.map(id => ({ id, outcome: "success", data: { id, status } })) } });
    });
    const outcome = await operation.executeBatch(grouped.host, [
      { target: metricTarget, input: { status: "PUBLISHED" } },
      { target: secondMetric, input: { status: "UNUSED" } },
      { target: thirdMetric, input: { status: "PUBLISHED" } },
    ]);
    expect(grouped.sent.map(sent => JSON.parse(String(sent.init.body)))).toEqual([
      { ids: ["m1", "m3"], status: "PUBLISHED" },
      { ids: ["m2"], status: "UNUSED" },
    ]);
    expect(outcome.kind === "batch" && outcome.items.map(item => [item.target.primaryKey, item.outcome.kind === "success" && item.outcome.data.status]))
      .toEqual([["m1", "PUBLISHED"], ["m2", "UNUSED"], ["m3", "PUBLISHED"]]);
  });

  it("answers every call of a status request the owner turns down whole, coded or not", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const secondMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m2" };
    const calls = [
      { target: metricTarget, input: { status: "PUBLISHED" } },
      { target: secondMetric, input: { status: "PUBLISHED" } },
    ];
    const refused = hostWith(() => Response.json({ success: false, code: "METRIC_VIEW_STATUS_INVALID", message: "ids: expected metric ids" }));
    expect(await operation.executeBatch(refused.host, calls)).toEqual({ kind: "batch", items: [
      { target: { objectType: METRIC_VIEW, primaryKey: "m1" },
        outcome: { kind: "refusal", code: "METRIC_VIEW_STATUS_INVALID", message: "ids: expected metric ids" } },
      { target: { objectType: METRIC_VIEW, primaryKey: "m2" },
        outcome: { kind: "refusal", code: "METRIC_VIEW_STATUS_INVALID", message: "ids: expected metric ids" } },
    ] });
    const failed = hostWith(() => Response.json({ success: false, message: "No business domain for this account" }));
    expect(await operation.executeBatch(failed.host, calls)).toEqual({ kind: "batch", items: [
      { target: { objectType: METRIC_VIEW, primaryKey: "m1" },
        outcome: { kind: "failure", code: "METRIC_VIEW_STATUS_FAILED", message: "No business domain for this account" } },
      { target: { objectType: METRIC_VIEW, primaryKey: "m2" },
        outcome: { kind: "failure", code: "METRIC_VIEW_STATUS_FAILED", message: "No business domain for this account" } },
    ] });
  });

  it("keeps the answered status requests of a batch when another gets no answer, and answers unknown when none does", async () => {
    const operation = batchAction(SET_METRIC_VIEW_STATUS);
    const secondMetric = { kind: "object" as const, objectType: METRIC_VIEW, primaryKey: "m2" };
    const calls = [
      { target: metricTarget, input: { status: "PUBLISHED" } },
      { target: secondMetric, input: { status: "UNUSED" } },
    ];
    const partly = hostWith((_path, init) => {
      const { ids, status } = JSON.parse(String(init.body)) as { ids: string[]; status: string };
      return status === "UNUSED"
        ? new Response("upstream down", { status: 502 })
        : Response.json({ success: true, data: { items: ids.map(id => ({ id, outcome: "success", data: { id, status } })) } });
    });
    const outcome = await operation.executeBatch(partly.host, calls);
    expect(outcome.kind === "batch" && outcome.items.map(item => [item.target.primaryKey, item.outcome.kind])).toEqual([
      ["m1", "success"], ["m2", "unknown"],
    ]);
    const unanswered = hostWith(() => new Response("upstream down", { status: 502 }));
    expect(await operation.executeBatch(unanswered.host, calls))
      .toEqual({ kind: "unknown", message: "Owner request failed: /metricView/setStatus" });
  });

  it("binds a function save to its target and refuses another id", async () => {
    const operation = write(`${FUNCTION}.save`);
    const rejected = hostWith(() => Response.json({ success: true, data: { id: "f1", name: "Revenue query" } }));
    await expect(operation.execute(rejected.host, functionTarget, { values: { id: "f2", name: "Revenue query" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    await expect(operation.execute(rejected.host, { kind: "draft" }, { values: { id: "f1", name: "Revenue query" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    expect(rejected.sent).toHaveLength(0);

    const updated = hostWith(() => Response.json({ success: true, data: { id: "f1", name: "Revenue query" } }));
    await operation.execute(updated.host, functionTarget, { values: { name: "Revenue query" } });
    expect(JSON.parse(String(updated.sent[0]?.init.body))).toEqual({ name: "Revenue query", id: "f1" });

    const created = hostWith(() => Response.json({ success: true, data: { id: "f-new", name: "Revenue query" } }));
    await operation.execute(created.host, { kind: "draft" }, { values: { name: "Revenue query" } });
    expect(JSON.parse(String(created.sent[0]?.init.body))).toEqual({ name: "Revenue query" });
  });

  it("declares and executes the function save and delete", async () => {
    const save = write(`${FUNCTION}.save`);
    if (save.kind !== "form.save") throw new Error("not a form save");
    expect(save.targetSchema.safeParse(functionTarget).success).toBe(true);
    expect(save.draftOperation(functionTarget)).toBe("function.update");
    const saved = hostWith(() => Response.json({ success: true, data: { id: "f1", name: "Revenue query" } }));
    expect(await save.execute(saved.host, functionTarget, { values: { name: "Revenue query" } }))
      .toEqual({
        kind: "success", data: { id: "f1", name: "Revenue query" },
        affected: { objects: [{ objectType: FUNCTION, primaryKey: "f1" }], objectTypes: [FUNCTION] },
      });
    expect(saved.sent[0]?.path).toBe("/api/data-query/function/save");
    expect(JSON.parse(String(saved.sent[0]?.init.body))).toEqual({ name: "Revenue query", id: "f1" });
    const saveRefused = hostWith(() => Response.json({
      success: false, code: "FUNCTION_REFERENCED", message: "Function referenced by MetricView cannot be modified or deleted",
    }));
    expect(await save.execute(saveRefused.host, functionTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "FUNCTION_REFERENCED", message: "Function referenced by MetricView cannot be modified or deleted" });

    const remove = action(DELETE_FUNCTION);
    const labelled = hostWith(path => path.endsWith("/function/queryById")
      ? Response.json({ success: true, data: { name: "Revenue query" } })
      : Response.json({ success: true }));
    expect(await remove.targetLabel(labelled.host, functionTarget)).toBe("Revenue query");
    const deleted = hostWith(() => Response.json({ success: true }));
    expect(await remove.execute(deleted.host, functionTarget)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: FUNCTION, primaryKey: functionTarget.primaryKey }], objectTypes: [FUNCTION] },
    });
    expect(deleted.sent[0]?.path).toBe("/api/data-query/function/delete");
    const deleteRefused = hostWith(() => Response.json({
      success: false, code: "FUNCTION_REFERENCED", message: "Function referenced by Action cannot be modified or deleted",
    }));
    expect(await remove.execute(deleteRefused.host, functionTarget))
      .toEqual({ kind: "refusal", code: "FUNCTION_REFERENCED", message: "Function referenced by Action cannot be modified or deleted" });
  });

  it("describes the function delete impact with the owner's reference rule", async () => {
    const operation = action(DELETE_FUNCTION);
    const labelled = hostWith(path => path.endsWith("/function/queryById")
      ? Response.json({ success: true, data: { name: "Revenue query" } })
      : Response.json({ success: true }));
    expect(await operation.inspectImpact!.inspect({ ...labelled.host, locale: "en" }, [{ target: functionTarget, input: {} }])).toEqual({
      summary: "This deletes the selected function; the owner refuses one referenced by a metric, an action or a write task.",
      objects: [{ target: { objectType: FUNCTION, primaryKey: "f1" }, label: "Revenue query" }],
      total: 1,
    });
    expect(JSON.parse(String(labelled.sent[0]?.init.body))).toEqual({ id: "f1" });
  });

  it("tests a metric draft with the chosen parameter values written into its parameter definitions", async () => {
    const operation = read(TEST_METRIC_VIEW);
    expect(operation.target).toEqual({ source: "draft", slot: "definition" });
    const draft = { name: "Revenue", function: { queryPackage: { manifest: { parameterDefs: [
      { name: "year", type: "TYPE_NUMBER", value: 2025 }, { name: "region", type: "TYPE_STRING", value: "east" },
    ] } } } };
    const tested = hostWith(() => Response.json({ success: true, data: { md: "| total |\n| 9 |" } }));
    expect(await operation.execute(tested.host, { target: metricTarget, input: { draft, parameters: { year: 2026 } } }))
      .toEqual({ kind: "markdown", markdown: "| total |\n| 9 |" });
    expect(tested.sent[0]?.path).toBe("/api/data-query/metricView/test");
    expect(JSON.parse(String(tested.sent[0]?.init.body)).function.queryPackage.manifest.parameterDefs).toEqual([
      { name: "year", type: "TYPE_NUMBER", value: 2026 }, { name: "region", type: "TYPE_STRING", value: "east" },
    ]);
    expect(draft.function.queryPackage.manifest.parameterDefs[0]?.value).toBe(2025);

    const refused = hostWith(() => Response.json({ success: false, message: "DSL error at answer.steps", code: "BUILD_TEST_FORBIDDEN" }));
    await expect(operation.execute(refused.host, { target: { kind: "draft" }, input: { draft, parameters: {} } }))
      .rejects.toMatchObject({ status: 422, code: "BUILD_TEST_FORBIDDEN", message: "DSL error at answer.steps" });
    const plainRefusal = hostWith(() => Response.json({ success: false, message: "Read Function not found" }));
    await expect(operation.execute(plainRefusal.host, { target: metricTarget, input: { draft, parameters: {} } }))
      .rejects.toMatchObject({ status: 422, code: "METRIC_VIEW_TEST_REFUSED" });
  });

  it("reads a trial's own input from a read call that names no target, and refuses input it cannot read", async () => {
    const draft = { name: "Revenue", function: { queryPackage: { manifest: { parameterDefs: [] } } } };
    const tested = hostWith(() => Response.json({ success: true, data: { md: "ok" } }));
    expect(await read(TEST_METRIC_VIEW).execute(tested.host, { input: { draft, parameters: {} } }))
      .toEqual({ kind: "markdown", markdown: "ok" });
    const ran = hostWith(() => Response.json({ success: true, data: [] }));
    expect(await read(TEST_EXECUTE_METRIC_VIEW).execute(ran.host, { input: { draft, parameters: { year: 2026 }, bindingId: "b1" } }))
      .toEqual({ kind: "json", value: { result: [] } });
    expect(JSON.parse(String(ran.sent[0]?.init.body))).toEqual({ metricView: draft, param: { year: 2026 }, bindingId: "b1" });

    const unread = hostWith(() => Response.json({ success: true, data: { md: "never" } }));
    await expect(read(TEST_METRIC_VIEW).execute(unread.host, { input: { parameters: {} } })).rejects.toThrow();
    expect(unread.sent).toEqual([]);
  });

  it("runs a metric draft for JSON with its parameters and binding, and keeps a truncated run marked", async () => {
    const operation = read(TEST_EXECUTE_METRIC_VIEW);
    const draft = { id: "m1", name: "Revenue", function: { queryPackage: { manifest: { parameterDefs: [] } } } };
    const complete = hostWith(() => Response.json({ success: true, data: [{ total: 9 }] }));
    expect(await operation.execute(complete.host, { target: metricTarget, input: { draft, parameters: { year: 2026 }, bindingId: "b1" } }))
      .toEqual({ kind: "json", value: { result: [{ total: 9 }] } });
    expect(complete.sent[0]?.path).toBe("/api/data-query/metricView/testExecute");
    expect(JSON.parse(String(complete.sent[0]?.init.body))).toEqual({ metricView: draft, param: { year: 2026 }, bindingId: "b1" });

    const truncated = hostWith(() => Response.json({
      success: true, data: [{ total: 9 }], truncated: true, rowLimit: 20000, truncationHint: "Narrow the time range",
    }));
    expect(await operation.execute(truncated.host, { target: metricTarget, input: { draft, parameters: {} } })).toEqual({
      kind: "json", value: { result: [{ total: 9 }], truncated: true, rowLimit: 20000, truncationHint: "Narrow the time range" },
    });
    expect(JSON.parse(String(truncated.sent[0]?.init.body))).toEqual({ metricView: draft, param: {} });

    const refused = hostWith(() => Response.json({ success: false, message: "Executable read metric not found" }));
    await expect(operation.execute(refused.host, { target: metricTarget, input: { draft, parameters: {} } }))
      .rejects.toMatchObject({ status: 422, code: "METRIC_VIEW_TEST_EXECUTE_REFUSED", message: "Executable read metric not found" });
  });

  it("declares each operation with its effect, result and target", () => {
    expect(m5ServerOperations.map(({ handlerRef, effect, batch, kind, ...rest }) =>
      ({
        handlerRef, effect, batch, kind,
        targetInput: "targetInput" in rest ? rest.targetInput : undefined,
        inspectImpact: "inspectImpact" in rest && rest.inspectImpact ? rest.inspectImpact.handlerRef : undefined,
      }))).toEqual([
      { handlerRef: `${METRIC_VIEW}.save`, effect: "write", batch: false, kind: "form.save", targetInput: undefined, inspectImpact: undefined },
      { handlerRef: DELETE_METRIC_VIEW, effect: "write", batch: false, kind: "action", targetInput: "metric", inspectImpact: `${DELETE_METRIC_VIEW}.inspect-impact` },
      { handlerRef: SET_METRIC_VIEW_STATUS, effect: "write", batch: true, kind: "action", targetInput: "metric", inspectImpact: undefined },
      { handlerRef: `${FUNCTION}.save`, effect: "write", batch: false, kind: "form.save", targetInput: undefined, inspectImpact: undefined },
      { handlerRef: DELETE_FUNCTION, effect: "write", batch: false, kind: "action", targetInput: "function", inspectImpact: `${DELETE_FUNCTION}.inspect-impact` },
      { handlerRef: TEST_METRIC_VIEW, effect: "read", batch: false, kind: "action", targetInput: undefined, inspectImpact: undefined },
      { handlerRef: TEST_EXECUTE_METRIC_VIEW, effect: "read", batch: false, kind: "action", targetInput: undefined, inspectImpact: undefined },
    ]);
  });
});
