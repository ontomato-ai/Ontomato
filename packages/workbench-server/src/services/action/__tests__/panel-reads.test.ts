import { afterEach, describe, expect, it, vi } from "vitest";
import { annotatedCodeSchema } from "@ontomato/contracts/annotated-code";
import { ACTION } from "@ontomato/contracts/panel-client-requests";
import { panelOperationDeclarationSchema, panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import { panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
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
  save: { method: "POST", path: "/api/data-query/action/save", bodySchema: {} },
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
  it("lists the actions with the owner's display names, status tones, and this owner's column names", async () => {
    const pending = { ...approve, id: "review-order", name: "Review order", status: "PENDING_REVIEW", statusLabel: "Pending review" };
    const unused = { ...approve, id: "legacy-order", name: "Legacy order", status: "UNUSED", statusLabel: "Unused" };
    ownerAnswering({ "/action/queryList": ok([approve, pending, unused]) });

    const records = await createActionReadAdapter(owner, viewer).list();

    expect(panelRecordListSchema.parse(records)).toEqual(records);
    expect(records[0]).toEqual({
      primaryKey: "approve-order", label: "Approve order", subtitle: "Approve a pending order",
      fieldLabels: {
        status: "Status", origin: "Origin", createdBy: "Created by", reviewedBy: "Last published by",
        function: "Linked function", updatedAt: "Last updated",
      },
      fields: {
        status: "Published", origin: "User", createdBy: "Alice", reviewedBy: "", function: "approve_order",
        updatedAt: "2026-11-20T08:30:00.000Z",
      },
      tones: { status: "success" },
    });
    expect(records[1]?.tones).toEqual({ status: "warning" });
    expect(records[2]?.tones).toEqual({ status: "info" });
  });

  it("counts through the same list URL without reading the list", async () => {
    const sent = ownerAnswering({ "/action/queryList": ok({ total: 3 }) });

    expect(await createActionReadAdapter(owner, viewer).count()).toEqual({ rows: [], total: 3 });
    expect(sent).toEqual([{ path: "/action/queryList", body: { countOnly: true } }]);
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

  it("projects derivedSummary, derivedEffects, derivedParameters, and derivedConditions as standard panel records", async () => {
    const richDefinition = {
      version: 1,
      source: "DERIVED",
      verified: false,
      name: "Approve order",
      description: "Approves and links an order",
      codeHash: "a".repeat(64),
      explanationVersion: 3,
      declaredTarget: { className: "Order", keyParameter: "order_id" },
      affects: ["Order", "AuditEntry"],
      effects: [
        { kind: "EXTERNAL_CALL", kindLabel: "External call", title: "Notify webhook", narrative: "Calls billing" },
        { kind: "DELETE_VECTOR", kindLabel: "Delete vector", attrName: "summary_vec", objectIdFrom: "order_id" },
        {
          kind: "CREATE_EDGE", kindLabel: "Create edge", relation: "APPROVED_BY",
          sourceClass: "Order", targetClass: "Reviewer", sourceObjectIdFrom: "order_id", targetObjectIdFrom: "reviewer_id",
        },
        { kind: "DELETE_OBJECT", kindLabel: "Delete object", className: "Draft", objectIdFrom: "draft_id" },
        {
          kind: "UPDATE_OBJECT", kindLabel: "Update object", title: "Mark approved", className: "Order",
          objectIdFrom: "order_id", assignments: [{ field: "status", valueFrom: "approved" }], guards: "status == 'open'",
        },
        { kind: "CREATE_OBJECT", kindLabel: "Create object", title: "Record audit", className: "AuditEntry" },
      ],
      parameters: [
        {
          name: "order_id", type: "TYPE_STRING", description: "Target order key",
          sample: "ORD-1", objectTypes: ["Order"], required: null, constraints: null,
        },
        {
          name: "note", type: "TYPE_STRING", description: null,
          sample: "ok", objectTypes: [], required: null, constraints: null,
        },
      ],
      submissionCriteria: {
        operator: "OR",
        conditions: [
          { objectParameter: "order_id", className: "Order", field: "status", operator: "=", value: "open", message: "Order must be open" },
          { objectParameter: "order_id", className: "Order", field: "status", operator: "=", value: "pending", failureMessage: "Must be pending" },
        ],
        unrepresentable: [
          { description: "Reviewer has budget authority", reason: "Checked dynamically in helper" },
        ],
        source: "GENERATED",
        verified: false,
      },
    };
    const codeSegments = [
      {
        id: "try-1",
        kind: "TRY_CATCH",
        kindLabel: "Try/Catch",
        title: "Protected approval",
        codeRange: { start: 1, end: 12 },
        trySegs: [
          {
            id: "upd-1",
            kind: "UPDATE_OBJECT",
            kindLabel: "Update object",
            title: "Mark approved",
            codeRange: { start: 2, end: 5 },
            class: "Order",
            objectIdFrom: "order_id",
            assignments: [{ field: "status", valueFrom: "approved" }],
          },
        ],
        branchArms: [
          {
            condition: "order_id != ''",
            segs: [
              {
                id: "edge-1",
                kind: "CREATE_EDGE",
                kindLabel: "Create edge",
                title: "Link reviewer",
                codeRange: { start: 6, end: 8 },
                sourceObjectIdFrom: "order_id",
              },
            ],
          },
        ],
      },
    ];
    ownerAnswering({ "/action/queryById": ok({ ...approve, definition: richDefinition, codeSegments }) });
    const adapter = createActionReadAdapter(owner, viewer);

    const summary = await adapter.derivedSummary("approve-order");
    expect(panelRecordSchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      primaryKey: "approve-order",
      label: "Approve order",
      subtitle: "Approves and links an order",
      fields: { declaredTarget: "Order ← order_id" },
      tags: { affects: ["Order", "AuditEntry"] },
    });

    const orderIdRef = {
      kind: "child-reference",
      parent: { objectType: ACTION, primaryKey: "approve-order" },
      collection: "parameters",
      primaryKey: "order_id",
      label: "order_id",
    };

    const effects = await adapter.derivedEffects("approve-order");
    expect(panelRecordListSchema.parse(effects)).toEqual(effects);
    // Ordered strictly by group: Creates -> Updates -> Deletes -> Relations -> Vector fields -> Other effects.
    expect(effects.map(row => row.fields.group)).toEqual([
      "Creates", "Updates", "Deletes", "Relations", "Vector fields", "Other effects",
    ]);
    expect(effects.map(row => row.tones?.kind)).toEqual([
      "success", "info", "danger", "success", "danger", "warning",
    ]);
    expect(effects[0]?.fields.target).toBe("AuditEntry");
    expect(effects[1]).toMatchObject({
      label: "Mark approved",
      fields: {
        group: "Updates",
        kind: "Update object",
        target: ["Order · Object ← ", orderIdRef],
        fields: "status ← approved",
        guards: "status == 'open'",
      },
    });
    expect(effects[3]?.fields.target).toEqual([
      "APPROVED_BY · Order → Reviewer · ← ",
      orderIdRef,
      " · → reviewer_id",
    ]);

    const parameters = await adapter.derivedParameters("approve-order");
    expect(panelRecordListSchema.parse(parameters)).toEqual(parameters);
    expect(parameters).toEqual([
      expect.objectContaining({
        primaryKey: "order_id",
        label: "order_id",
        subtitle: "Target order key",
        fields: {
          type: "TYPE_STRING",
          required: "",
          sample: "ORD-1",
          constraints: "",
          codeLocations: [
            {
              kind: "child-reference",
              parent: { objectType: ACTION, primaryKey: "approve-order" },
              collection: "codeSegments",
              primaryKey: "try-1",
              label: "Protected approval (L1–12)",
            },
            {
              kind: "child-reference",
              parent: { objectType: ACTION, primaryKey: "approve-order" },
              collection: "codeSegments",
              primaryKey: "upd-1",
              label: "Mark approved (L2–5)",
            },
            {
              kind: "child-reference",
              parent: { objectType: ACTION, primaryKey: "approve-order" },
              collection: "codeSegments",
              primaryKey: "edge-1",
              label: "Link reviewer (L6–8)",
            },
          ],
        },
        tags: { objectTypes: ["Order"] },
      }),
      expect.objectContaining({
        primaryKey: "note",
        label: "note",
        fields: { type: "TYPE_STRING", required: "", objectTypes: "", sample: "ok", constraints: "" },
      }),
    ]);
    expect(parameters[1]?.fields).not.toHaveProperty("codeLocations");

    const conditions = await adapter.derivedConditions("approve-order");
    expect(panelRecordListSchema.parse(conditions)).toEqual(conditions);
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).toMatchObject({
      label: "order_id Order.status = open",
      subtitle: "Order must be open",
      fields: {
        kind: "Rule",
        join: "OR",
        expression: [orderIdRef, " Order.status = open"],
        detail: "Order must be open",
      },
      tones: { kind: "info" },
    });
    expect(conditions[2]).toMatchObject({
      label: "Reviewer has budget authority",
      subtitle: "Checked dynamically in helper",
      fields: {
        kind: "Custom check",
        join: "",
        expression: "Reviewer has budget authority",
        detail: "Checked dynamically in helper",
      },
      tones: { kind: "warning" },
    });

    // Whitespace-only descriptions omit subtitle cleanly.
    ownerAnswering({ "/action/queryById": ok({ ...approve, description: "   " }) });
    const blankDescRecord = await adapter.record("approve-order");
    expect(blankDescRecord).not.toHaveProperty("subtitle");

    // Targetless action with empty affects, effects, parameters, and conditions.
    ownerAnswering({
      "/action/queryById": ok({
        ...approve,
        definition: { version: 1, source: "DERIVED", verified: false, name: "Empty", description: "  ", codeHash: null, explanationVersion: null },
      }),
    });
    const emptySummary = await adapter.derivedSummary("empty-action");
    expect(emptySummary).not.toHaveProperty("subtitle");
    expect(emptySummary.fields).toEqual({
      declaredTarget: "No target: the action runs on parameters alone",
      affects: "None",
    });
    expect(await adapter.derivedEffects("empty-action")).toEqual([]);
    expect(await adapter.derivedParameters("empty-action")).toEqual([]);
    expect(await adapter.derivedConditions("empty-action")).toEqual([]);
  });

  it("maps annotatedExplanation recursively across segs, trySegs, catchs, finallySegs, and branchArms with pre-split parameter refs", async () => {
    const explained = {
      ...approve,
      definition: {
        version: 1,
        source: "DERIVED",
        verified: false,
        name: "Approve order",
        parameters: [
          { name: "order", type: "TYPE_STRING", description: null, objectTypes: [], required: null, constraints: null },
          { name: "order_id", type: "TYPE_STRING", description: "Primary key", objectTypes: ["Order"], required: null, constraints: null },
        ],
      },
      function: {
        name: "approve_order",
        code: "def run(order_id, order):\n    pass\n",
      },
      codeSegments: [
        {
          id: "try-1",
          kind: "TRY_CATCH",
          kindLabel: "Try/Catch",
          title: "Protected approval",
          codeRange: { start: 1, end: 10 },
          narrative: "Guards approval write",
          trySegs: [
            {
              id: "upd-1",
              kind: "UPDATE_OBJECT",
              kindLabel: "Update object",
              title: "Update order",
              codeRange: { start: 2, end: 5 },
              class: "Order",
              objectIdFrom: "order_id",
              assignments: [{ field: "note", valueFrom: "concat(order_id, order)" }],
              filters: {
                objects: [{ alias: "o", class: "Order", conditions: "o.id == order_id" }],
                relationship: [{ from: "o", type: "HAS", to: "i" }],
              },
              output: { fields: ["status"], group_by: "status", sort: "created_at", limit: 10 },
            },
          ],
          catchs: [
            {
              error: "RuntimeError",
              segs: [
                { id: "err-1", kind: "ERROR_HANDLING", kindLabel: "Error handling", title: "Handle failure", codeRange: { start: 6, end: 7 } },
              ],
            },
          ],
          finallySegs: [
            { id: "fin-1", kind: "CUSTOM", kindLabel: "Cleanup", title: "Release lock", codeRange: { start: 8, end: 9 } },
          ],
        },
        {
          id: "br-1",
          kind: "BRANCH",
          kindLabel: "Branch",
          title: "Conditional follow-up",
          codeRange: { start: 11, end: 14 },
          branchArms: [
            {
              condition: "ok",
              segs: [
                {
                  id: "loop-1",
                  kind: "LOOP",
                  kindLabel: "Loop",
                  title: "Iterate items",
                  codeRange: { start: 12, end: 14 },
                  segs: [
                    { id: "q-1", kind: "QUERY", kindLabel: "Query", title: "Read item", codeRange: { start: 13, end: 13 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      businessMeaning: {
        operations: ["Approve the order", "Notify downstream billing"],
        negativeEffect: "Cannot be undone once billing starts.",
      },
    };
    ownerAnswering({ "/action/queryById": ok(explained) });
    const adapter = createActionReadAdapter(owner, viewer);

    const result = await adapter.annotatedExplanation("approve-order");
    expect(annotatedCodeSchema.parse(result)).toEqual(result);
    expect(result.code).toBe("def run(order_id, order):\n    pass\n");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      id: "try-1",
      tone: "warning",
      note: "Guards approval write",
      lineRange: { start: 1, end: 10 },
    });
    expect(result.segments[0]?.children?.map(child => [child.id, child.tone])).toEqual([
      ["upd-1", "accent"],
      ["err-1", "danger"],
      ["fin-1", "neutral"],
    ]);

    // Verify longest-first parameter reference tokenization (`order_id` does not split on shorter `order`).
    const updateDetails = result.segments[0]?.children?.[0]?.details ?? [];
    const fieldsRow = updateDetails.find(row => row.label === "Fields");
    expect(fieldsRow).toEqual({
      label: "Fields",
      parts: [
        { text: "note ← concat(" },
        { text: "order_id", refKey: "order_id" },
        { text: ", " },
        { text: "order", refKey: "order" },
        { text: ")" },
      ],
    });
    const objectFromRow = updateDetails.find(row => row.label === "Object from");
    expect(objectFromRow).toEqual({
      label: "Object from",
      parts: [{ text: "order_id", refKey: "order_id" }],
    });
    expect(updateDetails.some(row => row.label === "Objects read")).toBe(true);
    expect(updateDetails.some(row => row.label === "Relation")).toBe(true);
    expect(updateDetails.some(row => row.label === "Output fields")).toBe(true);
    expect(updateDetails.some(row => row.label === "Limit")).toBe(true);

    // Branch -> Loop -> Query nesting.
    expect(result.segments[1]?.children?.[0]?.id).toBe("loop-1");
    expect(result.segments[1]?.children?.[0]?.children?.[0]).toMatchObject({ id: "q-1", tone: "info" });

    // Summary sections from businessMeaning.
    expect(result.summary).toEqual([
      { title: "What it does", kind: "list", items: ["Approve the order", "Notify downstream billing"] },
      { title: "What can go wrong", kind: "text", text: "Cannot be undone once billing starts.", tone: "warning" },
    ]);

    // Unexplained action returns valid empty annotatedCode.
    ownerAnswering({ "/action/queryById": ok({ ...approve, codeSegments: null, businessMeaning: null }) });
    const emptyAnnotated = await adapter.annotatedExplanation("approve-order");
    expect(annotatedCodeSchema.parse(emptyAnnotated)).toEqual({
      code: "# ontomato-python:2",
      segments: [],
    });
  });

  it("asks the owner for the form of a new action an agent drafts into", async () => {
    const sent = ownerAnswering({ "/action/definitionForm": ok(form) });

    await createActionReadAdapter(owner, viewer).createForm({ values: { name: "Approve" }, changedField: null });

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

  it("declares published targeted and targetless Actions for an author's type table, preserving affects and per-type filtering", async () => {
    const objectAction = (id: string, className: string) => ({
      ...approve, id, codeHash: `hash-${id}`, target: { className, keyParameter: "key" },
      function: { name: id, parameters: [{ name: "key", type: "TYPE_STRING" }, { name: "note", type: "TYPE_STRING" }] },
    });
    const approveOrder = objectAction("approve-order", "Order");
    const closeInvoice = objectAction("close-invoice", "Invoice");
    const importOrders = {
      ...objectAction("import-orders", "Order"),
      name: "Import orders",
      target: null,
      definition: { affects: ["Order", "Invoice", "Order"] },
    };
    const sent = ownerAnswering({
      "/action/queryList": ok([
        approveOrder,
        importOrders,
        { ...objectAction("broken-invoice", "Invoice"), function: { parameters: [{ name: null, type: "TYPE_STRING" }] } },
        { ...objectAction("unnamed-invoice", "Invoice"), name: "  " },
        { ...closeInvoice, name: "Close invoice" },
      ]),
    });
    const adapter = createActionReadAdapter(owner, viewer);

    const { actions, unavailableActions } = await adapter.objectActions();
    expect(actions).toEqual([
      { className: "Order", name: "Approve order", declaration: objectActionDeclaration(approveOrder) },
      { className: null, name: "Import orders", declaration: objectActionDeclaration(importOrders), affects: ["Order", "Invoice"] },
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

  it("describes the status change and the delete from the catalog operations", async () => {
    const statusField = {
      path: "/status", label: "Publication state", required: false, readOnly: false,
      control: { kind: "select", options: [{
        value: "PUBLISHED", label: "Live", description: null, disabled: false, disabledReason: null,
      }] },
      valueSchema: { type: "string", enum: ["PUBLISHED"] },
    };
    const sent = ownerAnswering({ "/action/definitionForm": ok({ ...form, fields: [statusField] }) });
    const adapter = createActionReadAdapter(owner, viewer);

    const status = await adapter["actions.setStatus.describe"]();
    const remove = await adapter["actions.delete.describe"]();

    expect(panelOwnerOperationDescriptorSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      handlerRef: "actions.setStatus", label: "Change status", effect: "write", batch: true,
      target: { source: "input", input: "action" },
      inputSchema: { properties: { status: {
        title: statusField.label, oneOf: [{ const: "PUBLISHED", title: statusField.control.options[0].label }],
      } } },
    });
    expect((status.inputSchema.properties as { status: Record<string, unknown> }).status.description).toBeUndefined();
    expect(sent).toEqual([{ path: "/action/definitionForm", body: { target: { kind: "draft" }, changedField: null } }]);
    expect(status.inspectImpact?.handlerRef).toBe(`${status.handlerRef}.inspect-impact`);
    expect(remove).toMatchObject({
      handlerRef: "actions.delete", label: "Delete", effect: "write", batch: false,
      target: { source: "input", input: "action" }, inspectImpact: { handlerRef: "actions.delete.inspect-impact" },
    });
  });
});
