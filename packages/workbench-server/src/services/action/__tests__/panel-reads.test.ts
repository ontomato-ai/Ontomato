import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION } from "@ontomato/contracts/panel-client-requests";
import { panelOperationDeclarationSchema, panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import { panelRecordListSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { objectActionDeclaration } from "../object-actions";
import { createActionReadAdapter, readObjectActions } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));
// The operation registry these describes come from also registers the agent operations, whose page skills these reads never load.
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(), resolvePageSkillSource: vi.fn(), loadedPageSkillVersion: vi.fn(),
}));

/*
 * The action catalog's named reads: the reader's credentials and language reach the owner, the owner's display names
 * become the records with this owner's column names, the definition form is the owner's own description, the two
 * catalog operations are described from the operations the coordinator dispatches, and a refusal stays the owner's.
 */

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };
const approve = {
  id: "approve-order", name: "Approve order", description: "Approve a pending order", status: "PUBLISHED",
  statusLabel: "Published", origin: "USER", originLabel: "User", createdBy: "u1", createdByName: "Alice",
  reviewedBy: null, reviewedByName: null, function: { name: "approve_order", code: "# ontomato-python:2" },
  modifyTimestamp: Date.UTC(2026, 10, 20, 8, 30),
};
const form = {
  fields: [{
    path: "/name", label: "Name", required: true, defaultValue: null, help: null, readOnly: false,
    control: { kind: "text" }, valueSchema: { type: "string" },
  }],
  values: { name: "Approve order" },
  errors: [],
  save: { method: "POST", path: "/api/data-query/action/save", bodySchema: {}, draftOperation: "action.update" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function ownerAnswering(answers: Record<string, (body: Record<string, unknown>) => Response>) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    expect(headers.get("tk")).toBe(viewer.token);
    expect(headers.get("Accept-Language")).toBe(viewer.locale);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ path, body });
    const answer = answers[path];
    if (init.method !== "POST" || !answer) throw new Error(`Unexpected owner request ${init.method} ${path}`);
    return answer(body);
  }));
  return sent;
}

const ok = (data: unknown) => () => Response.json({ success: true, data });

describe("action catalog reads", () => {
  it("lists the actions with the owner's display names and this owner's column names", async () => {
    ownerAnswering({ "/action/queryList": ok([approve]) });

    const records = await createActionReadAdapter(owner, viewer).list();

    expect(panelRecordListSchema.parse(records)).toEqual(records);
    expect(records).toEqual([{
      primaryKey: "approve-order", label: "Approve order", subtitle: "Approve a pending order",
      fieldLabels: {
        status: "Status", origin: "Origin", createdBy: "Created by", reviewedBy: "Reviewed by", function: "Function",
        updatedAt: "Updated",
      },
      fields: {
        status: "Published", origin: "User", createdBy: "Alice", reviewedBy: "", function: "approve_order",
        updatedAt: "2026-11-20T08:30:00.000Z",
      },
    }]);
  });

  it("reads one action as a record", async () => {
    const sent = ownerAnswering({ "/action/queryById": ok(approve) });

    expect((await createActionReadAdapter(owner, viewer).record("approve-order")).label).toBe("Approve order");
    expect(sent[0]?.body).toEqual({ id: "approve-order" });
  });

  it("asks the owner for the definition form of the action, with the draft values and the changed field", async () => {
    const sent = ownerAnswering({ "/action/definitionForm": ok(form) });
    const adapter = createActionReadAdapter(owner, viewer);

    expect(await adapter.form("approve-order", {})).toEqual(form);
    await adapter.form("approve-order", { values: { name: "Approve" }, changedField: "/function/parameters" });

    expect(sent.map(request => request.body)).toEqual([
      { target: { kind: "object", objectType: ACTION, primaryKey: "approve-order" }, changedField: null },
      {
        target: { kind: "object", objectType: ACTION, primaryKey: "approve-order" },
        values: { name: "Approve" }, changedField: "/function/parameters",
      },
    ]);
  });

  it("reads the definition the owner derives and the saved explanation, with the owner's kind names", async () => {
    const definition = {
      version: 1, source: "DERIVED", verified: false, name: "Approve order", description: null, codeHash: "a".repeat(64),
      explanationVersion: 3, execution: { kind: "FUNCTION", operation: "OPERATION_WRITE" },
      effects: [{ kind: "UPDATE_OBJECT", kindLabel: "Update object", className: "Order" }], affects: ["Order"],
    };
    const segment = { id: "s1", kind: "UPDATE_OBJECT", kindLabel: "Update object", title: "Approve", codeRange: { start: 1, end: 4 } };
    const explained = {
      ...approve, codeHash: "a".repeat(64), explanationVersion: 3, definition,
      function: { ...approve.function, code: "# ontomato-python:2\nprint(1)" },
      codeSegments: [segment], businessMeaning: { operations: ["Approve the order"], negativeEffect: "" },
    };
    ownerAnswering({ "/action/queryById": ok(explained) });
    const adapter = createActionReadAdapter(owner, viewer);

    expect(await adapter.definition("approve-order")).toEqual(definition);
    expect(await adapter.explanation("approve-order")).toEqual({
      code: "# ontomato-python:2\nprint(1)", codeHash: "a".repeat(64), explanationVersion: 3, codeSegments: [segment],
      businessMeaning: { operations: ["Approve the order"], negativeEffect: "" },
    });

    ownerAnswering({ "/action/queryById": ok({ ...approve, codeHash: null, codeSegments: null, businessMeaning: null }) });
    expect(await adapter.explanation("approve-order")).toEqual({ code: "# ontomato-python:2", codeSegments: [] });

    ownerAnswering({ "/action/queryById": ok({ ...explained, codeSegments: [{ ...segment, kindLabel: undefined }] }) });
    await expect(adapter.explanation("approve-order")).rejects.toThrow();
  });

  it("asks the owner for the form of a new action an agent drafts into", async () => {
    const sent = ownerAnswering({ "/action/definitionForm": ok({ ...form, save: { ...form.save, draftOperation: "action.create" } }) });

    const created = await createActionReadAdapter(owner, viewer).createForm({ values: { name: "Approve" }, changedField: null });

    expect(created.save.draftOperation).toBe("action.create");
    expect(sent.map(request => request.body)).toEqual([
      { target: { kind: "draft" }, values: { name: "Approve" }, changedField: null },
    ]);
  });

  it("keeps the owner's coded refusal and reports an uncoded one as a failed read", async () => {
    ownerAnswering({ "/action/queryById": () => Response.json({ success: false, code: "ACTION_NOT_FOUND", message: "Action not found" }) });
    const refused = await createActionReadAdapter(owner, viewer).record("missing").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpError);
    expect([(refused as HttpError).status, (refused as HttpError).code, (refused as HttpError).message])
      .toEqual([404, "ACTION_NOT_FOUND", "Action not found"]);

    ownerAnswering({ "/action/queryList": () => Response.json({ success: false, message: "Data engine failed" }) });
    const failed = await createActionReadAdapter(owner, viewer).list().catch((error: unknown) => error);
    expect([(failed as HttpError).status, (failed as HttpError).code]).toEqual([500, "ACTION_READ_FAILED"]);
  });

  it("declares the published object Actions for an author's type table, by the object type each stored target names, under their stored names", async () => {
    const objectAction = (id: string, className: string) => ({
      ...approve, id, codeHash: `hash-${id}`, target: { className, keyParameter: "key" },
      function: { name: id, parameters: [{ name: "key", type: "TYPE_STRING" }, { name: "note", type: "TYPE_STRING" }] },
    });
    const approveOrder = objectAction("approve-order", "Order");
    const closeInvoice = objectAction("close-invoice", "Invoice");
    const sent = ownerAnswering({
      "/action/queryList": ok([
        approveOrder, { ...objectAction("import-orders", "Order"), target: null },
        { ...objectAction("broken-invoice", "Invoice"), function: { parameters: [{ name: null, type: "TYPE_STRING" }] } },
        { ...objectAction("unnamed-invoice", "Invoice"), name: "  " },
        { ...closeInvoice, name: "Close invoice" },
      ]),
    });
    const adapter = createActionReadAdapter(owner, viewer);

    const { actions, unavailableActions } = await adapter.objectActions();
    expect(actions).toEqual([
      { className: "Order", name: "Approve order", declaration: objectActionDeclaration(approveOrder) },
      { className: "Invoice", name: "Close invoice", declaration: objectActionDeclaration(closeInvoice) },
    ]);
    // An action a person and an agent could not call by name is unavailable, said item by item like any invalid one.
    expect(unavailableActions).toEqual([
      { id: "broken-invoice", objectType: "Invoice", reason: expect.stringContaining("function.parameters.0.name") },
      { id: "unnamed-invoice", objectType: "Invoice", reason: "Invalid stored action field 'name': The action has no name" },
    ]);
    for (const { declaration } of actions) expect(panelOperationDeclarationSchema.parse(declaration)).toEqual(declaration);
    // A skill package holds only the reader's credentials: the same catalog, read with them alone.
    const invoices = await readObjectActions(viewer, "Invoice");
    expect(invoices.actions.map(entry => entry.declaration.id)).toEqual(["close-invoice"]);
    expect(invoices.unavailableActions).toEqual(unavailableActions);
    expect(sent.map(request => request.body)).toEqual([{ status: "PUBLISHED" }, { status: "PUBLISHED" }]);
  });

  it("describes the status change and the delete from the catalog operations", () => {
    const adapter = createActionReadAdapter(owner, viewer);

    const status = adapter["actions.setStatus.describe"]();
    const remove = adapter["actions.delete.describe"]();

    expect(panelOwnerOperationDescriptorSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      handlerRef: "actions.setStatus", label: "Change status", effect: "write", batch: true,
      target: { source: "input", input: "action" },
    });
    expect(status.inspectImpact).toBeUndefined();
    expect(remove).toMatchObject({
      handlerRef: "actions.delete", label: "Delete", effect: "write", batch: false,
      target: { source: "input", input: "action" }, inspectImpact: { handlerRef: "actions.delete.inspect-impact" },
    });
  });
});
