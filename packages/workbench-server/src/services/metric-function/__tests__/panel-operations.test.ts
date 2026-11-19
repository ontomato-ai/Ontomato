import { describe, expect, it } from "vitest";
import {
  DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m5ServerOperations } from "../panel-operations";

/*
 * The metric and function server operations: their target shapes, the data-query requests they send, the success
 * data they return, the owner's business refusals as failures, and the delete label read.
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

    expect(outcome).toEqual({ kind: "success", data: { id: "m1", name: "Revenue 2" } });
    expect(sent[0]?.path).toBe("/api/data-query/metricView/save");
    expect(sent[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ name: "Revenue 2", bindings: [] });
  });

  it("turns a metric owner refusal into a business failure", async () => {
    const operation = m5ServerOperations.find(item => item.handlerRef === `${METRIC_VIEW}.save`)!;
    const { host } = hostWith(() => Response.json({ success: false, message: "Cannot modify a system MetricView" }));

    expect(await operation.execute(host, metricTarget, { values: {} }))
      .toEqual({ kind: "failure", code: "METRIC_VIEW_SAVE_REFUSED", message: "Cannot modify a system MetricView" });
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
    expect(await operation.execute(remove.host, metricTarget)).toEqual({ kind: "success", data: {} });
    expect(remove.sent[0]?.path).toBe("/api/data-query/metricView/delete");
    expect(JSON.parse(String(remove.sent[0]?.init.body))).toEqual({ id: "m1" });

    const refused = hostWith(() => Response.json({ success: false, message: "Cannot delete a system MetricView" }));
    expect(await operation.execute(refused.host, metricTarget))
      .toEqual({ kind: "failure", code: "METRIC_VIEW_DELETE_REFUSED", message: "Cannot delete a system MetricView" });
  });

  it("falls back to the metric id when the label cannot be read", async () => {
    const operation = m5ServerOperations.find(item => item.handlerRef === DELETE_METRIC_VIEW)!;
    if (operation.kind !== "action") throw new Error("not an action");
    for (const response of [Response.json({ success: false, message: "MetricView not found" }), new Response(null, { status: 404 })]) {
      const { host } = hostWith(() => response);
      expect(await operation.targetLabel(host, metricTarget)).toBe("m1");
    }
  });

  it("declares and executes the function save and delete", async () => {
    const save = m5ServerOperations.find(item => item.handlerRef === `${FUNCTION}.save`)!;
    if (save.kind !== "form.save") throw new Error("not a form save");
    expect(save.targetSchema.safeParse(functionTarget).success).toBe(true);
    expect(save.draftOperation(functionTarget)).toBe("function.update");
    const saved = hostWith(() => Response.json({ success: true, data: { id: "f1", name: "Revenue query" } }));
    expect(await save.execute(saved.host, functionTarget, { values: { name: "Revenue query" } }))
      .toEqual({ kind: "success", data: { id: "f1", name: "Revenue query" } });
    expect(saved.sent[0]?.path).toBe("/api/data-query/function/save");
    const saveRefused = hostWith(() => Response.json({ success: false, message: "Function referenced by MetricView cannot be modified or deleted" }));
    expect(await save.execute(saveRefused.host, functionTarget, { values: {} }))
      .toEqual({ kind: "failure", code: "FUNCTION_SAVE_REFUSED", message: "Function referenced by MetricView cannot be modified or deleted" });

    const remove = m5ServerOperations.find(item => item.handlerRef === DELETE_FUNCTION)!;
    if (remove.kind !== "action") throw new Error("not an action");
    const labelled = hostWith(path => path.endsWith("/function/queryById")
      ? Response.json({ success: true, data: { name: "Revenue query" } })
      : Response.json({ success: true }));
    expect(await remove.targetLabel(labelled.host, functionTarget)).toBe("Revenue query");
    const deleted = hostWith(() => Response.json({ success: true }));
    expect(await remove.execute(deleted.host, functionTarget)).toEqual({ kind: "success", data: {} });
    expect(deleted.sent[0]?.path).toBe("/api/data-query/function/delete");
    const deleteRefused = hostWith(() => Response.json({ success: false, message: "Function referenced by Action cannot be modified or deleted" }));
    expect(await remove.execute(deleteRefused.host, functionTarget))
      .toEqual({ kind: "failure", code: "FUNCTION_DELETE_REFUSED", message: "Function referenced by Action cannot be modified or deleted" });
  });
});
