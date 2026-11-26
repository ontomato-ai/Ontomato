import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, EXPORT_SKILL, FUNCTION, SKILL } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * When an operation completes and reports what changed through `instance.refresh(affected)`, each affected member's
 * admitted operations are read again automatically so button availability (`unavailable`) stays current without
 * manually calling `refreshObjects()`, while members bound to unrelated object types do not re-read.
 */

const meta = {
  domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "",
  editable: false, visibility: "domain" as const, description: "",
};
const knowledge = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });
const skill = (primaryKey: string) => ({ className: SKILL, primaryKey });

const projections: Record<string, ProductProjection> = {
  "knowledge-approve": {
    ...meta, id: "knowledge-approve", name: "Approve", componentId: "@ontomato/sdk:OperationButton",
    inputs: { entry: { kind: "object", objectType: BUSINESS_KNOWLEDGE } }, outputs: {},
    config: { operation: "approve", type: "primary" },
    data: {},
    operations: { approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "entry" } } },
  },
  "knowledge-batch-approve": {
    ...meta, id: "knowledge-batch-approve", name: "Approve checked", componentId: "@ontomato/sdk:OperationButton",
    inputs: { entries: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } }, outputs: {},
    config: { operation: "approve", type: "primary" },
    data: {},
    operations: { approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "entries" } } },
  },
  "skill-export": {
    ...meta, id: "skill-export", name: "Export", componentId: "@ontomato/sdk:OperationButton",
    inputs: { skill: { kind: "object", objectType: SKILL } }, outputs: {},
    config: { operation: "export" },
    data: {},
    operations: { export: { operation: { kind: "PlatformOperation", id: EXPORT_SKILL }, target: { input: "skill" } } },
  },
  "function-literal-op": {
    ...meta, id: "function-literal-op", name: "Literal target op", componentId: "@ontomato/sdk:OperationButton",
    inputs: {}, outputs: {},
    config: { operation: "check" },
    data: {},
    operations: {
      check: {
        operation: { kind: "PlatformOperation", id: "functions.delete" },
        target: { literal: { className: FUNCTION, primaryKey: "fn-1" } },
      },
    },
  },
  "targetless-op": {
    ...meta, id: "targetless-op", name: "Targetless op", componentId: "@ontomato/sdk:OperationButton",
    inputs: {}, outputs: {},
    config: { operation: "create" },
    data: {},
    operations: { create: { operation: { kind: "PlatformOperation", id: "fixture:create" } } },
  },
};

const manifest = definePanel({
  state: {
    selectedKnowledge: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    checkedKnowledge: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    selectedSkill: { type: { kind: "object", objectType: SKILL } },
  },
  members: {
    approve: { target: { projectionId: "knowledge-approve" }, inputs: { entry: { state: "selectedKnowledge" } } },
    approveAll: { target: { projectionId: "knowledge-batch-approve" }, inputs: { entries: { state: "checkedKnowledge" } } },
    exportSkill: { target: { projectionId: "skill-export" }, inputs: { skill: { state: "selectedSkill" } } },
    literalFn: { target: { projectionId: "function-literal-op" } },
    targetless: { target: { projectionId: "targetless-op" } },
  },
});

function mountMembers(instance: ReturnType<typeof createDirectPanelInstance>, members: readonly string[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({
    render: () => h("div", members.map((member) => h("div", { "data-member": member }, [h(PanelMember, { instance, member })]))),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { element, unmount: () => app.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("rereads affected member operations on refresh(affected) to update unavailable state while skipping unrelated members", async () => {
  const reads: PanelMemberReadRequest[] = [];
  let approveUnavailable: { reason: string } | undefined;

  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "knowledge", url: () => "/ontology/knowledge", label: () => "Knowledge",
    initial: {
      selectedKnowledge: knowledge("k-1"),
      checkedKnowledge: [knowledge("k-1"), knowledge("k-2")],
      selectedSkill: skill("s-1"),
    },
    text: createPanelText({}, ref("en"), "en"),
    operations: noOperations.operations,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    readProjection: async (id) => {
      const projection = projections[id];
      if (!projection) throw new Error(`Missing projection ${id}`);
      return projection;
    },
    read: async (request) => {
      reads.push(request);
      const member = request.memberPath.at(-1)?.member;
      if (member === "approve") {
        return {
          status: "ready",
          value: {
            approve: {
              kind: "action", handlerRef: APPROVE_KNOWLEDGE, label: "Approve", effect: "write",
              target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
              ...(approveUnavailable ? { unavailable: approveUnavailable } : {}),
            },
          } as never,
        };
      }
      if (member === "approveAll") {
        return {
          status: "ready",
          value: {
            approve: {
              kind: "action", handlerRef: APPROVE_KNOWLEDGE, label: "Approve all", effect: "write",
              target: { source: "input", input: "entries" }, inputSchema: {}, resultSchema: {}, batch: true,
            },
          } as never,
        };
      }
      if (member === "exportSkill") {
        return {
          status: "ready",
          value: {
            export: {
              kind: "action", handlerRef: EXPORT_SKILL, label: "Export", effect: "read",
              target: { source: "input", input: "skill" }, inputSchema: {}, resultSchema: {}, batch: false,
            },
          } as never,
        };
      }
      if (member === "literalFn") {
        return {
          status: "ready",
          value: {
            check: {
              kind: "action", handlerRef: "functions.delete", label: "Delete fn", effect: "write",
              target: { source: "literal", literal: { className: FUNCTION, primaryKey: "fn-1" } },
              inputSchema: {}, resultSchema: {}, batch: false,
            },
          } as never,
        };
      }
      return {
        status: "ready",
        value: {
          create: {
            kind: "action", handlerRef: "fixture:create", label: "Create", effect: "write",
            target: { source: "none" }, inputSchema: {}, resultSchema: {}, batch: false,
          },
        } as never,
      };
    },
  });

  const { element, unmount } = mountMembers(instance, ["approve", "approveAll", "exportSkill", "literalFn", "targetless"]);

  const countOpsReads = (member: string) =>
    reads.filter((read) => read.operations && read.memberPath.at(-1)?.member === member).length;

  await vi.waitFor(() => {
    const approveBtn = element.querySelector<HTMLButtonElement>('[data-member="approve"] button');
    const exportBtn = element.querySelector<HTMLButtonElement>('[data-member="exportSkill"] button');
    expect(approveBtn && !approveBtn.disabled).toBe(true);
    expect(exportBtn && !exportBtn.disabled).toBe(true);
    expect(countOpsReads("literalFn")).toBe(1);
    expect(countOpsReads("targetless")).toBe(1);
  });

  // BusinessKnowledge approved -> becomes unavailable; Skill & literal Function are unrelated and must not re-read.
  approveUnavailable = { reason: "Already approved" };
  const exportBefore = countOpsReads("exportSkill");
  const literalFnBefore = countOpsReads("literalFn");
  const approveBefore = countOpsReads("approve");
  const targetlessBefore = countOpsReads("targetless");

  instance.refresh({
    objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }],
    objectTypes: [BUSINESS_KNOWLEDGE],
  });

  await vi.waitFor(() => {
    const approveBtn = element.querySelector<HTMLButtonElement>('[data-member="approve"] button')!;
    expect(approveBtn.disabled).toBe(true);
    expect(element.querySelector('[data-member="approve"]')?.textContent).toContain("Already approved");
  });
  expect(countOpsReads("approve")).toBe(approveBefore + 1);
  expect(countOpsReads("targetless")).toBe(targetlessBefore + 1);
  expect(countOpsReads("exportSkill")).toBe(exportBefore);
  expect(countOpsReads("literalFn")).toBe(literalFnBefore);

  // BusinessKnowledge edited back to pending -> recovers to available on refresh(affected).
  approveUnavailable = undefined;
  instance.refresh({
    objects: [],
    objectTypes: [BUSINESS_KNOWLEDGE],
  });

  await vi.waitFor(() => {
    const approveBtn = element.querySelector<HTMLButtonElement>('[data-member="approve"] button')!;
    expect(approveBtn.disabled).toBe(false);
    expect(element.querySelector('[data-member="approve"]')?.textContent).not.toContain("Already approved");
  });
  expect(countOpsReads("exportSkill")).toBe(exportBefore);
  expect(countOpsReads("literalFn")).toBe(literalFnBefore);

  // Removing k-1 shrinks checkedKnowledge to [k-2] and triggers only one operations reread on approveAll.
  const approveAllBefore = countOpsReads("approveAll");
  instance.refresh({
    objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }],
    objectTypes: [BUSINESS_KNOWLEDGE],
    removed: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }],
  });
  await vi.waitFor(() => expect(countOpsReads("approveAll")).toBe(approveAllBefore + 1));
  await nextTick();
  expect(countOpsReads("approveAll")).toBe(approveAllBefore + 1);

  // Refreshing FUNCTION re-reads literalFn, leaving exportSkill untouched.
  instance.refresh({
    objects: [{ objectType: FUNCTION, primaryKey: "fn-1" }],
    objectTypes: [FUNCTION],
  });
  await vi.waitFor(() => expect(countOpsReads("literalFn")).toBe(literalFnBefore + 1));
  expect(countOpsReads("exportSkill")).toBe(exportBefore);

  // Empty affected payload triggers no extra operations reads.
  const totalBeforeEmpty = reads.filter((read) => read.operations).length;
  instance.refresh({ objects: [], objectTypes: [] });
  await nextTick();
  expect(reads.filter((read) => read.operations).length).toBe(totalBeforeEmpty);

  unmount();
});

it("rereads operations on a projection whose data source matches the affected type even with null inputs", async () => {
  const listWithRowOp: ProductProjection = {
    ...meta, id: "knowledge-list-ops", name: "Knowledge list", componentId: "@ontomato/sdk:OperationButton",
    inputs: { entry: { kind: "object", objectType: BUSINESS_KNOWLEDGE } }, outputs: {},
    config: { operation: "approve" },
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
    operations: { approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "entry" } } },
  };
  const listManifest = definePanel({
    state: { selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    members: { listOp: { target: { projectionId: listWithRowOp.id }, inputs: { entry: { state: "selected" } } } },
  });
  const reads: PanelMemberReadRequest[] = [];
  let unavailable: { reason: string } | undefined;

  const instance = createDirectPanelInstance(listManifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "knowledge", url: () => "/ontology/knowledge", label: () => "Knowledge",
    initial: {},
    text: createPanelText({}, ref("en"), "en"),
    operations: noOperations.operations,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    readProjection: async () => listWithRowOp,
    read: async (request) => {
      reads.push(request);
      return {
        status: "ready",
        value: {
          approve: {
            kind: "action", handlerRef: APPROVE_KNOWLEDGE, label: "Approve", effect: "write",
            target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false,
            ...(unavailable ? { unavailable } : {}),
          },
        } as never,
      };
    },
  });

  const { element, unmount } = mountMembers(instance, ["listOp"]);

  await vi.waitFor(() => expect(reads.filter((read) => read.operations)).toHaveLength(1));
  const before = reads.filter((read) => read.operations).length;

  // Unrelated type skips reread.
  instance.refresh({ objects: [{ objectType: SKILL, primaryKey: "s-1" }], objectTypes: [SKILL] });
  await nextTick();
  expect(reads.filter((read) => read.operations)).toHaveLength(before);

  // Matching data source type triggers reread and reflects new unavailable state.
  unavailable = { reason: "Locked by policy" };
  instance.refresh({ objects: [], objectTypes: [BUSINESS_KNOWLEDGE] });
  await vi.waitFor(() => expect(element.textContent).toContain("Locked by policy"));
  expect(reads.filter((read) => read.operations)).toHaveLength(before + 1);

  unmount();
});
