import { describe, expect, it } from "vitest";
import { ACTION, DELETE_ACTION, FUNCTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m6ServerOperations } from "../panel-operations";

/*
 * The action server operations: the form save and what it changes, the owner's business refusals as refusals, the
 * delete label read and impact, and the batch publication-status change grouped by status.
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
  const host: PanelOperationHost = {
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

  it("turns an action owner save refusal into a refusal", async () => {
    const operation = write(`${ACTION}.save`);
    const { host } = hostWith(() => Response.json({ success: false, message: "This action's code is frozen" }));

    expect(await operation.execute(host, actionTarget, { values: {} }))
      .toEqual({ kind: "refusal", code: "ACTION_SAVE_REFUSED", message: "This action's code is frozen" });
  });

  it("describes the delete impact with the target names", async () => {
    const operation = action(DELETE_ACTION);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { name: "Approve order" } }));

    expect(await operation.inspectImpact!.inspect({ ...host, locale: "en" }, [{ target: actionTarget, input: {} }])).toEqual({
      summary: "This deletes the selected action; the owner refuses a system action or one referenced by a scheduled task.",
      objects: [{ target: { objectType: ACTION, primaryKey: "a1" }, label: "Approve order" }],
      total: 1,
    });
    expect(sent[0]?.path).toBe("/api/data-query/action/queryById");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ id: "a1" });
  });

  it("deletes by id and turns the owner's delete refusal into a refusal", async () => {
    const operation = action(DELETE_ACTION);
    const removed = hostWith(() => Response.json({ success: true }));
    expect(await operation.execute(removed.host, actionTarget)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: ACTION, primaryKey: "a1" }], objectTypes: [ACTION] },
    });
    expect(removed.sent[0]?.path).toBe("/api/data-query/action/delete");
    expect(JSON.parse(String(removed.sent[0]?.init.body))).toEqual({ id: "a1" });

    const refused = hostWith(() => Response.json({ success: false, message: "Action is referenced by a scheduled task" }));
    expect(await operation.execute(refused.host, actionTarget))
      .toEqual({ kind: "refusal", code: "ACTION_DELETE_REFUSED", message: "Action is referenced by a scheduled task" });
  });

  it("answers each call of a status batch by its action and groups different statuses into one request per status", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const thirdAction = { kind: "object" as const, objectType: ACTION, primaryKey: "a3" };
    const grouped = hostWith((_path, init) => {
      const { ids, status } = JSON.parse(String(init.body)) as { ids: string[]; status: string };
      return Response.json({ success: true, data: { items: ids.map(id => id === "a3"
        ? { id, outcome: "failure", error: { message: "Action is frozen" } }
        : { id, outcome: "success", data: { id, status } }) } });
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
        kind: "success", data: { id: "a2", status: "UNUSED" },
        affected: { objects: [{ objectType: ACTION, primaryKey: "a2" }], objectTypes: [ACTION] },
      } },
      { target: { objectType: ACTION, primaryKey: "a3" }, outcome: {
        kind: "refusal", code: "ACTION_STATUS_REFUSED", message: "Action is frozen",
      } },
    ] });
  });

  it("refuses every call of a status batch the owner refuses wholesale", async () => {
    const operation = batchAction(SET_ACTION_STATUS);
    const refused = hostWith(() => Response.json({ success: false, message: "No business domain for this account" }));
    expect(await operation.executeBatch(refused.host, [
      { target: actionTarget, input: { status: "PUBLISHED" } },
      { target: secondAction, input: { status: "PUBLISHED" } },
    ])).toEqual({ kind: "batch", items: [
      { target: { objectType: ACTION, primaryKey: "a1" }, outcome: {
        kind: "refusal", code: "ACTION_STATUS_REFUSED", message: "No business domain for this account",
      } },
      { target: { objectType: ACTION, primaryKey: "a2" }, outcome: {
        kind: "refusal", code: "ACTION_STATUS_REFUSED", message: "No business domain for this account",
      } },
    ] });
  });
});
