import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelOperationIntent, PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE,
} from "@ontomato/contracts/panel-client-requests";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { m7ServerOperations } from "../panel-operations";

const dispatchState = vi.hoisted(() => ({
  intents: new Map<string, PanelOperationIntent>(),
  invalidatedTargets: [] as unknown[],
}));

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ callbackUrl: "http://workbench.test" }) } }));
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(),
  resolvePageSkillSource: vi.fn(),
  loadedPageSkillVersion: vi.fn(),
}));
vi.mock("../../product-panels/application-use", () => ({
  requirePanelUseEntry: async () => ({
    use: {
      id: "use-bk",
      panelId: "panel-bk",
      pageKey: "business-knowledge",
      path: "/ontology/knowledge",
      access: { access: "domain-member" as const },
      inputs: {},
    },
    framePanelId: undefined,
  }),
}));
vi.mock("../../product-panels/current", () => {
  const checkedPort = { kind: "list" as const, items: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE } };
  const panel = {
    id: "panel-bk",
    manifest: {
      state: {
        selected: { type: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE } },
        checked: { type: checkedPort },
      },
      members: {
        approve: { target: { projectionId: "proj-approve" }, inputs: { knowledge: { state: "selected" } } },
        approveAll: { target: { projectionId: "proj-approve-all" }, inputs: { knowledge: { state: "checked" } } },
      },
    },
  };
  const projections = {
    "proj-approve": {
      id: "proj-approve",
      name: "Approve",
      componentId: "@ontomato/sdk:OperationButton",
      binding: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE },
      inputs: { knowledge: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE } },
      data: {},
      operations: {
        approve: { operation: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE }, target: { input: "knowledge" } },
      },
    },
    "proj-approve-all": {
      id: "proj-approve-all",
      name: "Approve",
      componentId: "@ontomato/sdk:OperationButton",
      binding: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE },
      inputs: { knowledge: checkedPort },
      data: {},
      operations: {
        approve: { operation: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE }, target: { input: "knowledge" } },
      },
    },
  };
  return {
    readCurrentPanelRecord: async () => panel,
    requireDirectPanelMember: async (_owner: unknown, _credentials: unknown, _panel: unknown, slot: "approve" | "approveAll") => {
      const member = panel.manifest.members[slot];
      return { member, projection: projections[member.target.projectionId as keyof typeof projections] };
    },
  };
});
vi.mock("../../product-panels/operation-store", () => ({
  panelOperationStore: {
    async get(_owner: unknown, id: string) {
      const intent = dispatchState.intents.get(id);
      if (!intent) throw new Error(`Unknown intent ${id}`);
      return { kind: "current" as const, intent: structuredClone(intent) };
    },
    async insert(_owner: unknown, intent: PanelOperationIntent) {
      dispatchState.intents.set(intent.intentId, structuredClone(intent));
      return { kind: "current" as const, intent: structuredClone(intent) };
    },
    async claim(_owner: unknown, intent: PanelOperationIntent) {
      const existing = dispatchState.intents.get(intent.intentId);
      if (!existing || existing.dispatched || existing.invalidated) return false;
      dispatchState.intents.set(intent.intentId, structuredClone({ ...intent, dispatched: true }));
      return true;
    },
    async outcome(_owner: unknown, id: string, outcome: PanelOperationOutcome) {
      const existing = dispatchState.intents.get(id);
      if (existing) existing.outcome = structuredClone(outcome);
    },
    async invalidatePendingObjectWrites(_owner: unknown, _excludeId: string, objects: readonly unknown[]) {
      dispatchState.invalidatedTargets.push(...objects);
    },
  },
}));

import { dispatchHumanPanelOperation, prepareHumanPanelOperation } from "../../product-panels/operations";

/*
 * The business knowledge server operations: their target shapes, the data-query requests they send, the success data they
 * return with what changed, the owner's business refusals as refusals, the approve and delete label read from the
 * whole-domain list the owner keeps, the per-call answers of an approve or delete batch, and the delete impact a
 * confirmation reads.
 */

// The delete impact reads its localized summary through the installed English pack.
configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

const actor = { owner: { domainId: "domain", userId: "user" }, credentials: { token: "token", locale: "en" } };

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
      throw new Error("The business knowledge owner does not use the workbench request");
    },
  };
  return { host, sent };
}

const entry = {
  knowledgeID: "k-1", knowledgeTitle: "Order rule", knowledgeText: "Orders need a customer",
  knowledgeTags: ["Business"], status: 0, creatorType: 1,
};
const target = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" };
/** The owner answers the named path with the given envelope and every other request with a plain success. */
const answers = (path: string, body: unknown) => (requestPath: string) =>
  requestPath.endsWith(path) ? Response.json(body) : Response.json({ success: true });
const values = { knowledgeID: "", knowledgeTitle: "Order rule", knowledgeText: "Orders need a customer", knowledgeTags: ["Business"], status: 1 };

describe("business knowledge panel server operations", () => {
  it("accepts knowledge entry and draft targets for form saves", () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    expect(operation.kind).toBe("form.save");
    if (operation.kind !== "form.save") throw new Error("not a form save");
    expect(operation.binding).toEqual({ kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE });
    expect(operation.targetSchema.safeParse(target).success).toBe(true);
    expect(operation.targetSchema.safeParse({ ...target, objectType: "platform:FeedbackRecord" }).success).toBe(false);
    expect(operation.targetSchema.safeParse({ kind: "draft" }).success).toBe(true);
  });

  it("sends a new entry's complete values and answers the stored id", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    const { host, sent } = hostWith(answers("/admin/addBussinessKnowledge", { success: true, data: { id: "k-new" } }));

    const outcome = await operation.execute(host, { kind: "draft" }, { values });

    expect(outcome).toEqual({
      kind: "success", data: { id: "k-new" },
      affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-new" }], objectTypes: [BUSINESS_KNOWLEDGE] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/admin/addBussinessKnowledge");
    expect(sent[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual(values);
  });

  it("sends only the submitted fields, so a field left alone is not overwritten with what the form still shows", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    const { host, sent } = hostWith(answers("/admin/editBussinessKnowledge", { success: true }));

    await operation.execute(host, target, {
      values: { ...values, knowledgeID: "k-1", knowledgeText: "Orders need a verified customer", status: 0 },
      submittedFields: ["/knowledgeText", "/knowledgeTags/0"],
    });

    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      knowledgeID: "k-1", knowledgeText: "Orders need a verified customer", knowledgeTags: ["Business"],
    });
  });

  it("updates the selected entry and answers no data beyond it", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    const { host, sent } = hostWith(answers("/admin/editBussinessKnowledge", { success: true }));

    const outcome = await operation.execute(host, target, {
      values: { knowledgeTitle: "Order rule 2", knowledgeText: "Orders need a customer", knowledgeTags: [], status: 0 },
    });

    expect(outcome).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/admin/editBussinessKnowledge");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      knowledgeTitle: "Order rule 2", knowledgeText: "Orders need a customer", knowledgeTags: [], status: 0, knowledgeID: "k-1",
    });
  });

  it("binds a save to its target and refuses another id", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    const rejected = hostWith(answers("/admin/addBussinessKnowledge", { success: true, data: { id: "k-new" } }));
    await expect(operation.execute(rejected.host, target, { values: { ...values, knowledgeID: "k-2" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    await expect(operation.execute(rejected.host, { kind: "draft" }, { values: { ...values, knowledgeID: "k-1" } }))
      .rejects.toMatchObject({ status: 400, code: "TARGET_ID_MISMATCH" });
    expect(rejected.sent).toHaveLength(0);

    const named = hostWith(answers("/admin/editBussinessKnowledge", { success: true }));
    await operation.execute(named.host, target, { values: { ...values, knowledgeID: "k-1" } });
    expect(JSON.parse(String(named.sent[0]?.init.body))).toEqual({ ...values, knowledgeID: "k-1" });

    // The owner's own form fills an empty id for a draft, so a blank one is a create's, not another entry's.
    const blank = hostWith(answers("/admin/addBussinessKnowledge", { success: true, data: { id: "k-new" } }));
    await operation.execute(blank.host, { kind: "draft" }, { values });
    expect(JSON.parse(String(blank.sent[0]?.init.body))).toEqual(values);
  });

  it("turns an owner save refusal into a refusal", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === `${BUSINESS_KNOWLEDGE}.save`)!;
    const { host } = hostWith(() => Response.json({ success: false, message: "Content is required" }));

    expect(await operation.execute(host, target, {
      values: { knowledgeTitle: "Order rule", knowledgeText: "Orders need a customer", knowledgeTags: [], status: 1 },
    })).toEqual({ kind: "refusal", code: "KNOWLEDGE_SAVE_REFUSED", message: "Content is required" });
  });

  it("reads the entry's title from the owner's list for a confirmation", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === APPROVE_KNOWLEDGE)!;
    expect(operation.kind).toBe("action");
    if (operation.kind !== "action") throw new Error("not an action");
    expect(operation.targetSchema.safeParse({ kind: "draft" }).success).toBe(false);
    const labelled = hostWith(answers("/admin/getBussinessKnowledge", { success: true, data: { "k-1": entry } }));
    expect(await operation.targetLabel(labelled.host, target)).toBe("Order rule");
    expect(JSON.parse(String(labelled.sent[0]?.init.body))).toEqual({});

    const refused = hostWith(() => Response.json({ success: false, message: "This domain has no knowledge" }));
    await expect(operation.targetLabel(refused.host, target))
      .rejects.toMatchObject({ status: 404, message: "This domain has no knowledge", code: "KNOWLEDGE_UNAVAILABLE" });
    const outage = hostWith(() => Response.json({ message: "Owner unavailable" }, { status: 503 }));
    await expect(operation.targetLabel(outage.host, target))
      .rejects.toMatchObject({ status: 503, message: "Owner unavailable", code: "KNOWLEDGE_UNAVAILABLE" });
    const missing = hostWith(answers("/admin/getBussinessKnowledge", { success: true, data: {} }));
    await expect(operation.targetLabel(missing.host, target))
      .rejects.toMatchObject({ status: 404, message: "Business knowledge k-1 is not in this domain", code: "KNOWLEDGE_UNAVAILABLE" });
  });

  it("approves the whole entry with status 1", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === APPROVE_KNOWLEDGE)!;
    if (operation.kind !== "action") throw new Error("not an action");
    const { host, sent } = hostWith(path => path.endsWith("/admin/getBussinessKnowledge")
      ? Response.json({ success: true, data: { "k-1": entry } })
      : Response.json({ success: true }));

    expect(await operation.execute(host, target)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE] },
    });
    expect(sent[1]?.path).toBe("/api/data-query/admin/editBussinessKnowledge");
    expect(JSON.parse(String(sent[1]?.init.body))).toEqual({ ...entry, status: 1 });

    // An entry written before tags existed is rewritten with an empty list, as the owner's form requires them.
    const untagged = hostWith(path => path.endsWith("/admin/getBussinessKnowledge")
      ? Response.json({ success: true, data: { "k-1": { ...entry, knowledgeTags: null } } })
      : Response.json({ success: true }));
    await operation.execute(untagged.host, target);
    expect(JSON.parse(String(untagged.sent[1]?.init.body))).toEqual({ ...entry, knowledgeTags: [], status: 1 });

    const missing = hostWith(answers("/admin/getBussinessKnowledge", { success: true, data: {} }));
    expect(await operation.execute(missing.host, target)).toEqual({
      kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED", message: "Business knowledge k-1 is not in this domain",
    });

    const refused = hostWith(path => path.endsWith("/admin/getBussinessKnowledge")
      ? Response.json({ success: true, data: { "k-1": entry } })
      : Response.json({ success: false, message: "The entry is governed elsewhere" }));
    expect(await operation.execute(refused.host, target)).toEqual({
      kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED", message: "The entry is governed elsewhere",
    });

    const alreadyApproved = hostWith(answers("/admin/getBussinessKnowledge", {
      success: true,
      data: { "k-1": { ...entry, status: 1 } },
    }));
    expect(await operation.execute({ ...alreadyApproved.host, locale: "en" }, target)).toEqual({
      kind: "refusal",
      code: "KNOWLEDGE_APPROVE_REFUSED",
      message: en["panels.knowledge.alreadyApproved"],
    });
    expect(alreadyApproved.sent.filter(item => item.path.endsWith("/admin/editBussinessKnowledge"))).toHaveLength(0);
  });

  it("reports approve availability from owner status for single and batch checks", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === APPROVE_KNOWLEDGE)!;
    if (operation.kind !== "action" || !operation.unavailable || !operation.unavailableBatch) {
      throw new Error("Expected approve action with availability hooks");
    }
    const approved = { ...entry, knowledgeID: "k-2", status: 1 };
    const { host, sent } = hostWith(answers("/admin/getBussinessKnowledge", {
      success: true,
      data: { "k-1": entry, "k-2": approved },
    }));
    const localizedHost = { ...host, locale: "en" };

    expect(await operation.unavailable(localizedHost, target)).toBeUndefined();
    expect(await operation.unavailable(localizedHost, { ...target, primaryKey: "k-2" })).toEqual({
      reason: en["panels.knowledge.alreadyApproved"],
    });
    expect(await operation.unavailable(localizedHost, { ...target, primaryKey: "k-missing" })).toEqual({
      reason: en["panels.knowledge.notFound"],
    });

    const beforeBatch = sent.length;
    const batchReasons = await operation.unavailableBatch(localizedHost, [
      { rowKey: "k-1", target },
      { rowKey: "k-2", target: { ...target, primaryKey: "k-2" } },
      { rowKey: "k-missing", target: { ...target, primaryKey: "k-missing" } },
    ]);
    expect(sent.length - beforeBatch).toBe(1);
    expect(batchReasons.get("k-1")).toBeUndefined();
    expect(batchReasons.get("k-2")).toEqual({ reason: en["panels.knowledge.alreadyApproved"] });
    expect(batchReasons.get("k-missing")).toEqual({ reason: en["panels.knowledge.notFound"] });
  });

  it("deletes by key and refuses with the owner's reason", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === DELETE_KNOWLEDGE)!;
    if (operation.kind !== "action") throw new Error("not an action");
    const { host, sent } = hostWith(answers("/admin/delBussinessKnowledge", { success: true }));
    expect(await operation.execute(host, target)).toEqual({
      kind: "success", data: {},
      affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE], removed: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/admin/delBussinessKnowledge");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ knowledgeID: "k-1" });

    const refused = hostWith(() => Response.json({ success: false, message: "The entry is governed elsewhere" }));
    expect(await operation.execute(refused.host, target)).toEqual({
      kind: "refusal", code: "KNOWLEDGE_DELETE_REFUSED", message: "The entry is governed elsewhere",
    });
  });

  it("answers an approve batch per call from one list read", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === APPROVE_KNOWLEDGE)!;
    if (operation.kind !== "action" || !operation.executeBatch) throw new Error("not a batch action");
    const second = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
    const third = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" };
    const { host, sent } = hostWith((path, init) => {
      if (path.endsWith("/admin/getBussinessKnowledge"))
        return Response.json({ success: true, data: {
          "k-1": entry,
          "k-2": { ...entry, knowledgeID: "k-2", knowledgeTitle: "Return rule", status: 0 },
        } });
      const { knowledgeID } = JSON.parse(String(init.body)) as { knowledgeID: string };
      return knowledgeID === "k-1"
        ? Response.json({ success: true })
        : Response.json({ success: false, message: "The entry is governed elsewhere" });
    });

    expect(await operation.executeBatch(host, [
      { target, input: {} }, { target: second, input: {} }, { target: third, input: {} },
    ])).toEqual({ kind: "batch", items: [
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, outcome: {
        kind: "success", data: {}, affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE] } } },
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, outcome: {
        kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED", message: "The entry is governed elsewhere" } },
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }, outcome: {
        kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED", message: "Business knowledge k-3 is not in this domain" } },
    ] });
    // One read of the whole domain serves every call, exactly as one read serves a single approval.
    expect(sent.filter(item => item.path.endsWith("/admin/getBussinessKnowledge"))).toHaveLength(1);
    expect(JSON.parse(String(sent[1]?.init.body))).toEqual({ ...entry, status: 1 });
    expect(JSON.parse(String(sent[2]?.init.body))).toEqual({ ...entry, knowledgeID: "k-2", knowledgeTitle: "Return rule", status: 1 });

    // An unreadable list leaves the whole batch without an answer, as no call has been made yet.
    const refused = hostWith(() => Response.json({ success: false, message: "This domain has no knowledge" }));
    await expect(operation.executeBatch(refused.host, [{ target, input: {} }]))
      .rejects.toMatchObject({ status: 404, message: "This domain has no knowledge", code: "KNOWLEDGE_UNAVAILABLE" });
  });

  it("keeps an approve batch's other answers when one call has none", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === APPROVE_KNOWLEDGE)!;
    if (operation.kind !== "action" || !operation.executeBatch) throw new Error("not a batch action");
    const second = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
    const { host } = hostWith((path, init) => {
      if (path.endsWith("/admin/getBussinessKnowledge"))
        return Response.json({ success: true, data: { "k-1": entry, "k-2": { ...entry, knowledgeID: "k-2" } } });
      const { knowledgeID } = JSON.parse(String(init.body)) as { knowledgeID: string };
      return knowledgeID === "k-1"
        ? Response.json({ message: "Owner unavailable" }, { status: 503 })
        : Response.json({ success: true });
    });

    expect(await operation.executeBatch(host, [{ target, input: {} }, { target: second, input: {} }])).toEqual({ kind: "batch", items: [
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, outcome: {
        kind: "unknown", message: "Owner request failed: /admin/editBussinessKnowledge" } },
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, outcome: {
        kind: "success", data: {}, affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }], objectTypes: [BUSINESS_KNOWLEDGE] } } },
    ] });
  });

  it("deletes a batch per call and answers each", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === DELETE_KNOWLEDGE)!;
    if (operation.kind !== "action" || !operation.executeBatch) throw new Error("not a batch action");
    const second = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
    const third = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" };
    const { host, sent } = hostWith((path, init) => {
      const { knowledgeID } = JSON.parse(String(init.body)) as { knowledgeID: string };
      if (knowledgeID === "k-2") return Response.json({ success: false, message: "The entry is governed elsewhere" });
      if (knowledgeID === "k-3") return Response.json({ message: "Owner unavailable" }, { status: 503 });
      return Response.json({ success: true });
    });

    expect(await operation.executeBatch(host, [
      { target, input: {} }, { target: second, input: {} }, { target: third, input: {} },
    ])).toEqual({ kind: "batch", items: [
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, outcome: {
        kind: "success", data: {}, affected: { objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }], objectTypes: [BUSINESS_KNOWLEDGE], removed: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }] } } },
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, outcome: {
        kind: "refusal", code: "KNOWLEDGE_DELETE_REFUSED", message: "The entry is governed elsewhere" } },
      { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }, outcome: {
        kind: "unknown", message: "Owner request failed: /admin/delBussinessKnowledge" } },
    ] });
    expect(sent.map(item => JSON.parse(String(item.init.body)))).toEqual([
      { knowledgeID: "k-1" }, { knowledgeID: "k-2" }, { knowledgeID: "k-3" },
    ]);
  });

  it("names the entries a delete takes by title and count", async () => {
    const operation = m7ServerOperations.find(item => item.handlerRef === DELETE_KNOWLEDGE)!;
    if (operation.kind !== "action" || !operation.inspectImpact) throw new Error("no impact description");
    const second = { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
    const labelled = hostWith(answers("/admin/getBussinessKnowledge", { success: true, data: {
      "k-1": entry, "k-2": { ...entry, knowledgeID: "k-2", knowledgeTitle: "Return rule" },
    } }));
    expect(await operation.inspectImpact.inspect({ ...labelled.host, locale: "en" }, [
      { target, input: {} }, { target: second, input: {} },
    ])).toEqual({
      summary: "This deletes the selected business knowledge (2 in total).",
      objects: [
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, label: "Order rule" },
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, label: "Return rule" },
      ],
      total: 2,
    });
    // An entry this domain no longer has is the owner's error, named as the label read names it.
    const missing = hostWith(answers("/admin/getBussinessKnowledge", { success: true, data: { "k-2": { ...entry, knowledgeID: "k-2" } } }));
    await expect(operation.inspectImpact.inspect({ ...missing.host, locale: "en" }, [{ target, input: {} }]))
      .rejects.toMatchObject({ status: 404, message: "Business knowledge k-1 is not in this domain", code: "KNOWLEDGE_UNAVAILABLE" });
  });

  it("declares each operation as a write with its result, target input and impact", () => {
    expect(m7ServerOperations.map(({ handlerRef, effect, batch, kind, ...rest }) =>
      ({ handlerRef, effect, batch, kind,
        targetInput: "targetInput" in rest ? rest.targetInput : undefined,
        inspectImpact: "inspectImpact" in rest && rest.inspectImpact ? rest.inspectImpact.handlerRef : undefined }))).toEqual([
      { handlerRef: `${BUSINESS_KNOWLEDGE}.save`, effect: "write", batch: false, kind: "form.save", targetInput: undefined, inspectImpact: undefined },
      { handlerRef: APPROVE_KNOWLEDGE, effect: "write", batch: true, kind: "action", targetInput: "knowledge", inspectImpact: undefined },
      { handlerRef: DELETE_KNOWLEDGE, effect: "write", batch: true, kind: "action", targetInput: "knowledge", inspectImpact: `${DELETE_KNOWLEDGE}.inspect-impact` },
    ]);
  });
});

describe("business knowledge batch approval through panel dispatch", () => {
  beforeEach(() => {
    dispatchState.intents.clear();
    dispatchState.invalidatedTargets.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOwnerFetch(entries: Record<string, typeof entry>) {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: Parameters<typeof fetch>[1]) => {
      const targetUrl = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      sent.push({ url: targetUrl, body });
      if (targetUrl.endsWith("/admin/getBussinessKnowledge")) {
        return Response.json({ success: true, data: entries });
      }
      if (targetUrl.endsWith("/admin/editBussinessKnowledge")) {
        return Response.json({ success: true });
      }
      throw new Error(`Unexpected fetch URL: ${targetUrl}`);
    }));
    return sent;
  }

  it("skips already-approved entries in a mixed batch and only edits pending entries", async () => {
    const pending = { ...entry, knowledgeID: "k-1", knowledgeTitle: "Pending rule", status: 0 };
    const approved = { ...entry, knowledgeID: "k-2", knowledgeTitle: "Approved rule", status: 1 };
    const sent = stubOwnerFetch({ "k-1": pending, "k-2": approved });

    const calls = [
      { target: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
      { target: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, input: {} },
    ] as const;

    const prepared = await prepareHumanPanelOperation(actor.owner, actor.credentials, {
      applicationId: "ontology",
      useId: "use-bk",
      operationId: "approveAll.approve",
      calls: [...calls],
    });
    expect(prepared.confirmation).toMatchObject({
      kind: "batch",
      targets: { total: 1, objects: [{ label: pending.knowledgeTitle }] },
      skippedSummary: expect.stringMatching(/\b1\b.*will be skipped/i),
    });
    expect(JSON.stringify(prepared.confirmation)).not.toContain(approved.knowledgeTitle);
    const dispatched = await dispatchHumanPanelOperation(actor.owner, actor.credentials, prepared.intentId);

    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId: prepared.intentId,
      outcome: {
        kind: "batch",
        items: [
          {
            target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" },
            outcome: { kind: "skipped", reason: en["panels.knowledge.alreadyApproved"] },
          },
          {
            target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" },
            outcome: {
              kind: "success",
              data: {},
              affected: {
                objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }],
                objectTypes: [BUSINESS_KNOWLEDGE],
              },
            },
          },
        ],
        affected: {
          objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }],
          objectTypes: [BUSINESS_KNOWLEDGE],
        },
      },
    });

    const edits = sent.filter(item => item.url.endsWith("/admin/editBussinessKnowledge"));
    expect(edits).toHaveLength(1);
    expect(edits[0]?.body).toEqual({ ...pending, status: 1 });
  });

  it("returns all skipped without calling editBussinessKnowledge when every entry is already approved", async () => {
    const approvedA = { ...entry, knowledgeID: "k-1", knowledgeTitle: "Approved A", status: 1 };
    const approvedB = { ...entry, knowledgeID: "k-2", knowledgeTitle: "Approved B", status: 1 };
    const sent = stubOwnerFetch({ "k-1": approvedA, "k-2": approvedB });

    const prepared = await prepareHumanPanelOperation(actor.owner, actor.credentials, {
      applicationId: "ontology",
      useId: "use-bk",
      operationId: "approveAll.approve",
      calls: [
        { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, input: {} },
        { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
      ],
    });
    expect(prepared.confirmation).toMatchObject({
      kind: "batch",
      targets: { total: 0, objects: [] },
      skippedSummary: expect.stringMatching(/\b2\b.*will be skipped/i),
    });
    expect(prepared.confirmation).not.toHaveProperty("impact");
    const dispatched = await dispatchHumanPanelOperation(actor.owner, actor.credentials, prepared.intentId);

    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId: prepared.intentId,
      outcome: {
        kind: "batch",
        items: [
          {
            target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" },
            outcome: { kind: "skipped", reason: en["panels.knowledge.alreadyApproved"] },
          },
          {
            target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" },
            outcome: { kind: "skipped", reason: en["panels.knowledge.alreadyApproved"] },
          },
        ],
      },
    });
    expect(sent.filter(item => item.url.endsWith("/admin/editBussinessKnowledge"))).toHaveLength(0);
    expect(dispatchState.invalidatedTargets).toHaveLength(0);
  });

  it("refuses a direct single approve dispatch when the entry is already approved", async () => {
    const approved = { ...entry, knowledgeID: "k-1", knowledgeTitle: "Approved A", status: 1 };
    const sent = stubOwnerFetch({ "k-1": approved });

    const prepared = await prepareHumanPanelOperation(actor.owner, actor.credentials, {
      applicationId: "ontology",
      useId: "use-bk",
      operationId: "approve.approve",
      call: { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, input: {} },
    });
    const dispatched = await dispatchHumanPanelOperation(actor.owner, actor.credentials, prepared.intentId);

    expect(dispatched).toEqual({
      kind: "dispatched",
      intentId: prepared.intentId,
      outcome: {
        kind: "refusal",
        code: "KNOWLEDGE_APPROVE_REFUSED",
        message: en["panels.knowledge.alreadyApproved"],
      },
    });
    expect(sent.filter(item => item.url.endsWith("/admin/editBussinessKnowledge"))).toHaveLength(0);
  });
});
