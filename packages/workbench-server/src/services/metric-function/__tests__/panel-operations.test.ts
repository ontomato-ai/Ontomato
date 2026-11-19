import { describe, expect, it } from "vitest";
import {
  DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m5ServerOperations } from "../panel-operations";

/*
 * The metric and function server operations: their target shapes, the data-query requests they send, the success
 * data they return with what changed, the owner's business refusals as refusals, and the delete label read.
 */

function hostWith(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => Response) {
  const sent: { path: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = [];
  const host: PanelOperationHost = {
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
    const operation = m5ServerOperations.find(item => item.handlerRef === `${METRIC_VIEW}.save`)!;
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
    const operation = m5ServerOperations.find(item => item.handlerRef === `${METRIC_VIEW}.save`)!;
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
    const operation = m5ServerOperations.find(item => item.handlerRef === `${METRIC_VIEW}.save`)!;
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
    const operation = m5ServerOperations.find(item => item.handlerRef === `${METRIC_VIEW}.save`)!;
    const { host } = hostWith(() => Response.json({ success: false, message: "Cannot modify a system MetricView" }));

    expect(await operation.execute(host, metricTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_SAVE_REFUSED", message: "Cannot modify a system MetricView" });
  });

  it("reads the metric label and deletes by id", async () => {
    const operation = m5ServerOperations.find(item => item.handlerRef === DELETE_METRIC_VIEW)!;
    expect(operation.kind).toBe("action");
    if (operation.kind !== "action") throw new Error("not an action");
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

    const refused = hostWith(() => Response.json({ success: false, message: "Cannot delete a system MetricView" }));
    expect(await operation.execute(refused.host, metricTarget))
      .toEqual({ kind: "refusal", code: "METRIC_VIEW_DELETE_REFUSED", message: "Cannot delete a system MetricView" });
  });

  it("fails the metric label read with the owner's reason", async () => {
    const operation = m5ServerOperations.find(item => item.handlerRef === DELETE_METRIC_VIEW)!;
    if (operation.kind !== "action") throw new Error("not an action");
    const missing = hostWith(() => Response.json({ success: false, message: "MetricView not found" }));
    await expect(operation.targetLabel(missing.host, metricTarget))
      .rejects.toMatchObject({ status: 404, message: "MetricView not found", code: "METRIC_VIEW_UNAVAILABLE" });
    const outage = hostWith(() => Response.json({ message: "Owner unavailable" }, { status: 503 }));
    await expect(operation.targetLabel(outage.host, metricTarget))
      .rejects.toMatchObject({ status: 503, message: "Owner unavailable", code: "METRIC_VIEW_UNAVAILABLE" });
  });

  it("binds a function save to its target and refuses another id", async () => {
    const operation = m5ServerOperations.find(item => item.handlerRef === `${FUNCTION}.save`)!;
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
    const save = m5ServerOperations.find(item => item.handlerRef === `${FUNCTION}.save`)!;
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
    const saveRefused = hostWith(() => Response.json({ success: false, message: "Function referenced by MetricView cannot be modified or deleted" }));
    expect(await save.execute(saveRefused.host, functionTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "FUNCTION_SAVE_REFUSED", message: "Function referenced by MetricView cannot be modified or deleted" });

    const remove = m5ServerOperations.find(item => item.handlerRef === DELETE_FUNCTION)!;
    if (remove.kind !== "action") throw new Error("not an action");
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
    const deleteRefused = hostWith(() => Response.json({ success: false, message: "Function referenced by Action cannot be modified or deleted" }));
    expect(await remove.execute(deleteRefused.host, functionTarget))
      .toEqual({ kind: "refusal", code: "FUNCTION_DELETE_REFUSED", message: "Function referenced by Action cannot be modified or deleted" });
  });

  it("declares each operation as a single write with its result and target input", () => {
    expect(m5ServerOperations.map(({ handlerRef, effect, batch, kind, ...rest }) =>
      ({ handlerRef, effect, batch, kind, targetInput: "targetInput" in rest ? rest.targetInput : undefined }))).toEqual([
      { handlerRef: `${METRIC_VIEW}.save`, effect: "write", batch: false, kind: "form.save", targetInput: undefined },
      { handlerRef: DELETE_METRIC_VIEW, effect: "write", batch: false, kind: "action", targetInput: "metric" },
      { handlerRef: `${FUNCTION}.save`, effect: "write", batch: false, kind: "form.save", targetInput: undefined },
      { handlerRef: DELETE_FUNCTION, effect: "write", batch: false, kind: "action", targetInput: "function" },
    ]);
  });
});
