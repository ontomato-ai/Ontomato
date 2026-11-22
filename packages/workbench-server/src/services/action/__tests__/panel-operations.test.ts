import { describe, expect, it } from "vitest";
import { ACTION, DELETE_ACTION, FUNCTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m6ServerOperations } from "../panel-operations";

/*
 * The action server operations: the form save and what it changes, the owner's explicit refusals kept apart from
 * failures, the delete label read and impact, and the batch publication-status change grouped by status and by the
 * answer each group received.
 */

// The impact description reads its localized summary through the installed English pack.
configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

type M6Operation = (typeof m6ServerOperations)[number];
const write = (handlerRef: string) =>
  m6ServerOperations.find((item): item is Extract<M6Operation, { effect: "write" }> =>
    item.effect === "write" && item.handlerRef === handlerRef)!;
const action = (handlerRef: string) =>
  m6ServerOperations.find((item): item is Extract<M6Operation, { effect: "write"; kind: "action"; batch: false }> =>
    item.effect === "write" && item.kind === "action" && item.batch === false && item.handlerRef === handlerRef)!;
const batchAction = (handlerRef: string) =>
  m6ServerOperations.find((item): item is Extract<M6Operation, { effect: "write"; kind: "action"; batch: true }> =>
    item.effect === "write" && item.kind === "action" && item.batch === true && item.handlerRef === handlerRef)!;

function hostWith(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => Response) {
  const sent: { path: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = [];
  const actor = { owner: { domainId: "d", userId: "U" }, credentials: { token: "U-token", locale: "en" } };
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    async request(path, init) {
      sent.push({ path, init });
      return answer(path, init);
    },
    async requestWorkbench() {
      throw new Error("The action owner does not use the workbench request");
    },
  };
  return { host, sent };
}

const actionTarget = { kind: "object" as const, objectType: ACTION, primaryKey: "a1" };
const secondAction = { kind: "object" as const, objectType: ACTION, primaryKey: "a2" };

describe("action panel server operations", () => {
  it("declares the action save target, draft operations and create identity", () => {
    const operation = write(`${ACTION}.save`);
    expect(operation.kind).toBe("form.save");
    if (operation.kind !== "form.save") throw new Error("not a form save");
    expect(operation.binding).toEqual({ kind: "PlatformObjectType", id: ACTION });
    expect(operation.targetSchema.safeParse(actionTarget).success).toBe(true);
    expect(operation.targetSchema.safeParse({ ...actionTarget, objectType: FUNCTION }).success).toBe(false);
    expect(operation.targetSchema.safeParse({ kind: "draft" }).success).toBe(true);
    expect(operation.draftOperation(actionTarget)).toBe("action.update");
    expect(operation.draftOperation({ kind: "draft" })).toBe("action.create");
    expect(operation.create?.createdObject({ id: "created" })).toEqual({ objectType: ACTION, primaryKey: "created" });
  });

  it("sends the complete action values and reports both the action and its function as changed", async () => {
    const operation = write(`${ACTION}.save`);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { id: "a1", name: "Approve order" } }));

    const outcome = await operation.execute(host, actionTarget, {
      values: { name: "Approve order", explanationRef: "ref-1" },
    });

    expect(outcome).toEqual({
      kind: "success", data: { id: "a1", name: "Approve order" },
      affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION, FUNCTION] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/action/save");
    expect(sent[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      name: "Approve order", explanationRef: "ref-1", id: "a1",
    });
  });

  it("passes the fields a partial save submitted to the owner, which changes only those", async () => {
    const operation = write(`${ACTION}.save`);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { id: "a1", name: "Approve open order" } }));

    await operation.execute(host, actionTarget, { values: { name: "Approve open order" }, submittedFields: ["/name"] });

    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      name: "Approve open order", id: "a1", submittedFields: ["/name"],
    });
  });

  it("keeps an explicit owner code as the save refusal and an unclassified save as a failure", async () => {
    const operation = write(`${ACTION}.save`);
    const refused = hostWith(() =>
      Response.json({ success: false, code: "ACTION_SYSTEM", message: "Cannot modify a system Action" }));
    expect(await operation.execute(refused.host, actionTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "ACTION_SYSTEM", message: "Cannot modify a system Action" });

    const failed = hostWith(() =>
      Response.json({ success: false, message: "Action service unavailable" }));
    expect(await operation.execute(failed.host, actionTarget, { values: {} }))
      .toEqual({ kind: "failure", code: "ACTION_SAVE_FAILED", message: "Action service unavailable" });
  });

  it("keeps the owner's field errors on a save refusal", async () => {
    const operation = write(`${ACTION}.save`);
    const message = "Action.publishedIsFrozen";
    const errors = [{ field: "/function/code", code: "invalid_object", message }];
    const { host } = hostWith(() =>
      Response.json({ success: false, code: "ACTION_PUBLISHED_FROZEN", message, errors }));

    expect(await operation.execute(host, actionTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "ACTION_PUBLISHED_FROZEN", message, errors });
  });

  it("describes the delete impact with the target names", async () => {
    const operation = action(DELETE_ACTION);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { name: "Approve order" } }));

    expect(await operation.inspectImpact!.inspect({ ...host, locale: "en" }, [{ target: actionTarget, input: {} }])).toEqual({
      summary: "This deletes the selected action with its definition and code explanation; the write function it uses stays. The owner refuses a system action or one a scheduled task runs.",
      objects: [{ target: { objectType: ACTION, primaryKey: "a1" }, label: "Approve order" }],
      total: 1,
    });
    expect(sent[0]?.path).toBe("/api/data-query/action/queryById");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ id: "a1" });
  });

  it("reads the system-action delete reason from its owner", async () => {
    const operation = action(DELETE_ACTION);
    const reason = "系统自带动作不能删除";
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { reason } }));
    expect(await operation.unavailable!(host, actionTarget)).toEqual({ reason });
    expect(sent[0]?.path).toBe("/api/data-query/action/queryById");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ id: "a1", purpose: "delete-availability" });
  });

  it("deletes by id, keeps an explicit owner code as the refusal and an unclassified delete as a failure", async () => {
    const operation = action(DELETE_ACTION);
    const removed = hostWith(() => Response.json({ success: true }));
    expect(await operation.execute(removed.host, actionTarget)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION] },
    });
    expect(removed.sent[0]?.path).toBe("/api/data-query/action/delete");
    expect(JSON.parse(String(removed.sent[0]?.init.body))).toEqual({ id: "a1" });

    const refused = hostWith(() =>
      Response.json({ success: false, code: "ACTION_REFERENCED", message: "Action is referenced by a scheduled task" }));
    expect(await operation.execute(refused.host, actionTarget))
      .toEqual({ kind: "refusal", code: "ACTION_REFERENCED", message: "Action is referenced by a scheduled task" });

    const failed = hostWith(() =>
      Response.json({ success: false, message: "Action service unavailable" }));
    expect(await operation.execute(failed.host, actionTarget))
      .toEqual({ kind: "failure", code: "ACTION_DELETE_FAILED", message: "Action service unavailable" });
  });

  it("answers success, refusal and failure for each action of one status group", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const thirdAction = { kind: "object" as const, objectType: ACTION, primaryKey: "a3" };
    const answered = hostWith(() => Response.json({ success: true, data: { items: [
      { id: "a1", outcome: "success", data: { id: "a1", status: "PUBLISHED" } },
      { id: "a2", outcome: "refusal", code: "ACTION_SYSTEM", error: { message: "Cannot modify a system Action" } },
      { id: "a3", outcome: "failure", error: { message: "database unavailable" } },
    ] } }));

    const outcome = await operation.executeBatch(answered.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "PUBLISHED" } },
      { target: thirdAction, input: { status: "PUBLISHED" } },
    ]);

    expect(outcome).toEqual({ kind: "batch", items: [
      { target: { objectType: ACTION, primaryKey: "a1" }, outcome: {
        kind: "success", data: { id: "a1", status: "PUBLISHED" },
        affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION] },
      } },
      { target: { objectType: ACTION, primaryKey: "a2" }, outcome: {
        kind: "refusal", code: "ACTION_SYSTEM", message: "Cannot modify a system Action",
      } },
      { target: { objectType: ACTION, primaryKey: "a3" }, outcome: {
        kind: "failure", code: "ACTION_STATUS_FAILED", message: "database unavailable",
      } },
    ] });
    expect(JSON.parse(String(answered.sent[0]?.init.body))).toEqual({ ids: ["a1", "a2", "a3"], status: "PUBLISHED" });
  });

  it("keeps the successful status group when another group has no receipt", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const thirdAction = { kind: "object" as const, objectType: ACTION, primaryKey: "a3" };
    const grouped = hostWith((_path, init) => {
      const { ids, status } = JSON.parse(String(init.body)) as { ids: string[]; status: string };
      if (status === "UNUSED") return Response.json({ message: "Owner unavailable" }, { status: 503 });
      return Response.json({ success: true, data: { items: ids.map(id => ({
        id, outcome: "success", data: { id, status },
      })) } });
    });

    const outcome = await operation.executeBatch(grouped.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "UNUSED" } },
      { target: thirdAction, input: { status: "PUBLISHED" } },
    ]);

    expect(grouped.sent.map(sent => JSON.parse(String(sent.init.body)))).toEqual([
      { ids: ["a1", "a3"], status: "PUBLISHED" },
      { ids: ["a2"], status: "UNUSED" },
    ]);
    expect(outcome).toEqual({ kind: "batch", items: [
      { target: { objectType: ACTION, primaryKey: "a1" }, outcome: {
        kind: "success", data: { id: "a1", status: "PUBLISHED" },
        affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION] },
      } },
      { target: { objectType: ACTION, primaryKey: "a2" }, outcome: {
        kind: "unknown", message: "Owner request failed: /action/setStatus",
      } },
      { target: { objectType: ACTION, primaryKey: "a3" }, outcome: {
        kind: "success", data: { id: "a3", status: "PUBLISHED" },
        affected: { objects: [{ objectType: ACTION, primaryKey: "a3" }], objectTypes: [ACTION] },
      } },
    ] });
  });

  it("leaves only the group unknown whose receipt carries an unreadable saved action", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const grouped = hostWith((_path, init) => {
      const { ids, status } = JSON.parse(String(init.body)) as { ids: string[]; status: string };
      // The unused group's saved action has no id: that receipt cannot be read, the other one still counts.
      return Response.json({ success: true, data: { items: ids.map(id => ({
        id, outcome: "success", data: status === "UNUSED" ? { status } : { id, status },
      })) } });
    });

    const outcome = await operation.executeBatch(grouped.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "UNUSED" } },
    ]);

    expect(outcome.kind).toBe("batch");
    if (outcome.kind !== "batch") return;
    expect(outcome.items[0]).toEqual({ target: { objectType: ACTION, primaryKey: "a1" }, outcome: {
      kind: "success", data: { id: "a1", status: "PUBLISHED" },
      affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION] },
    } });
    expect(outcome.items[1]!.outcome.kind).toBe("unknown");
  });

  it("answers unknown as a whole when no status group has a receipt", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const grouped = hostWith(() => Response.json({ message: "Owner unavailable" }, { status: 503 }));

    const outcome = await operation.executeBatch(grouped.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "UNUSED" } },
    ]);

    expect(outcome).toEqual({ kind: "unknown", message: "Owner request failed: /action/setStatus" });
  });

  it("turns a coded wholesale status refusal into a refusal for every action of the group", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const refused = hostWith(() =>
      Response.json({ success: false, code: "ACTION_STATUS_INVALID", message: "status: expected PENDING_REVIEW, PUBLISHED or UNUSED" }));

    expect(await operation.executeBatch(refused.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "PUBLISHED" } },
    ])).toEqual({ kind: "batch", items: [
      { target: { objectType: ACTION, primaryKey: "a1" }, outcome: {
        kind: "refusal", code: "ACTION_STATUS_INVALID", message: "status: expected PENDING_REVIEW, PUBLISHED or UNUSED",
      } },
      { target: { objectType: ACTION, primaryKey: "a2" }, outcome: {
        kind: "refusal", code: "ACTION_STATUS_INVALID", message: "status: expected PENDING_REVIEW, PUBLISHED or UNUSED",
      } },
    ] });
  });
});
