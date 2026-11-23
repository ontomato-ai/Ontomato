import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel, panelOperationSchema } from "@ontomato/contracts/panel-manifest";
import { BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { BatchItemOperationOutcome, PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * The business knowledge page's batch delete, drawn directly (the node's acceptance page): the reader checks several
 * items and deletes them with one button, or an agent invokes the same operation by its ID. Either way it is one batch,
 * one call per checked item, prepared once at the platform's coordinator; what the owner did not delete stays checked.
 *
 * What this rules out: a checked list that is no target, so the panel's operations cannot be described at all; an
 * agent's call that acts on nothing; a batch split into separate writes; items the owner refused unchecked as if deleted.
 */

const item = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });
const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const removeAll: ProductProjection = {
  ...record, id: "knowledge-delete-checked", name: "Delete", componentId: "@ontomato/sdk:OperationButton",
  inputs: { selection: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } }, outputs: {},
  config: { operation: "delete", type: "danger" },
  data: {},
  operations: { delete: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "selection" } } },
};
const list: ProductProjection = {
  ...record, id: "knowledge-list", name: "Knowledge", componentId: "@ontomato/sdk:ObjectList",
  config: {},
  inputs: {},
  outputs: { checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
};
const removeMember = { target: { projectionId: removeAll.id }, inputs: { selection: { state: "checked" } } } as const;
const manifest = definePanel({
  state: { checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } } },
  members: { removeAll: removeMember },
});
const listManifest = definePanel({
  state: manifest.state,
  members: {
    list: { target: { projectionId: list.id }, outputs: { checked: { state: "checked" } } },
    removeAll: removeMember,
  },
});
const deleteKnowledge = {
  kind: "action", handlerRef: DELETE_KNOWLEDGE, label: "Delete", effect: "write", target: { source: "input", input: "selection" },
  inputSchema: {}, resultSchema: {}, batch: true,
};

const success = { kind: "success", data: {} } as const;
const skipped = { kind: "skipped", reason: "Already approved" } as const;
const rows = [
  { primaryKey: "k-1", label: "Refund policy", fields: {} },
  { primaryKey: "k-2", label: "Shipping policy", fields: {} },
];

function open(listOutcomes?: readonly [BatchItemOperationOutcome, BatchItemOperationOutcome]) {
  const prepared: unknown[] = [];
  const instance = createDirectPanelInstance(listOutcomes ? listManifest : manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "knowledge", url: () => "/ontology/knowledge", label: () => "Knowledge",
    initial: { checked: [item("k-1"), item("k-2")] },
    text: createPanelText({}, ref("en"), "en"),
    operations: {
      ...noOperations.operations,
      prepare: async (operationId, invocation): Promise<PanelHumanOperationPreparation> => {
        prepared.push([operationId, invocation]);
        // The standalone case has one unnamed target.
        const objects = (listOutcomes ? rows : rows.slice(0, 1)).map(({ primaryKey, label }) => ({
          target: { objectType: BUSINESS_KNOWLEDGE, primaryKey }, label,
        }));
        return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d07", operationId, label: "Delete", confirmation: {
          kind: "batch", targets: { total: 2, objects },
        } };
      },
    },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: {
      kind: "batch",
      items: [
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, outcome: listOutcomes?.[0] ?? success },
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, outcome: listOutcomes?.[1] ?? { kind: "refusal", code: "IN_USE", message: "Still cited" } },
      ],
    } } }),
    readProjection: async (id) => id === list.id ? list : removeAll,
    read: async (request) => ({
      status: "ready", value: (request.operations ? { delete: deleteKnowledge } : { rows, total: rows.length }) as never,
    }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  const bulkButton = () => h(PanelMember, { instance, member: "removeAll" });
  const app = createApp({ render: () => listOutcomes
    ? h(PanelMember, { instance, member: "list" }, { "batch-actions": bulkButton })
    : bulkButton() });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, prepared, unmount: () => app.unmount() };
}

const batch = { calls: [
  { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-1" }, input: {} },
  { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
] };

afterEach(() => {
  document.body.innerHTML = "";
});

it("deletes the checked items as one batch from the button, and keeps checked what the owner did not delete", async () => {
  const { instance, element, prepared, unmount } = open();
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("The button is not ready");
    return found;
  });
  // The panel's operations are described for the header and an agent, the checked list as the target.
  const described = instance.operations.value.map(({ invoke: _invoke, ...operation }) => panelOperationSchema.parse(operation));
  expect(described).toMatchObject([{ id: "removeAll.delete", target: { source: "state", state: "checked" } }]);

  button.click();
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-batch")?.textContent).toContain("1 of 2"));
  // Each result by the name the owner gave it, and by its key where it gave none.
  expect([...element.querySelectorAll(".sdk-operation-batch li")].map((row) => row.textContent?.trim()))
    .toEqual([`Refund policy: ${publicEn.platform.operationDone}`, "k-2: Still cited"]);
  expect(prepared).toEqual([["removeAll.delete", batch]]);
  expect(instance.state.values.value.checked).toEqual([item("k-2")]);
  unmount();
});

it("runs an agent's call of the same operation as one batch over what is checked", async () => {
  const { instance, prepared, unmount } = open();
  await vi.waitFor(() => expect(instance.operations.value.map(({ id }) => id)).toEqual(["removeAll.delete"]));
  await instance.invoke("removeAll.delete");
  expect(prepared).toEqual([["removeAll.delete", batch]]);

  instance.state.set("checked", []);
  await expect(instance.invoke("removeAll.delete")).rejects.toThrow("none is checked");
  expect(prepared).toHaveLength(1);
  unmount();
});

it.each([
  { name: "all successful", outcomes: [success, success] as const, checked: [] },
  { name: "partially skipped", outcomes: [success, skipped] as const, checked: [item("k-2")] },
  { name: "all skipped", outcomes: [skipped, skipped] as const, checked: [item("k-1"), item("k-2")] },
])("keeps a single dismissible list receipt for a $name batch", async ({ outcomes, checked }) => {
  const { instance, element, unmount } = open(outcomes);
  try {
    await vi.waitFor(() => {
      const button = element.querySelector<HTMLButtonElement>(".sdk-object-list-batch-actions .sdk-operation-button button");
      expect(button?.disabled).toBe(false);
      expect(element.querySelector(".sdk-object-list-item-btn")).not.toBeNull();
    });
    element.querySelector<HTMLButtonElement>(".sdk-object-list-batch-actions .sdk-operation-button button")!.click();
    const selector = ".sdk-object-list-batch-receipt";
    await vi.waitFor(() => expect(element.querySelector(selector)).not.toBeNull());
    expect(instance.state.values.value.checked).toEqual(checked);
    expect(Boolean(element.querySelector(".sdk-object-list-batch-actions"))).toBe(checked.length > 0);
    expect(element.querySelectorAll(".sdk-batch-receipt")).toHaveLength(1);

    const items = [...element.querySelectorAll(`${selector} li`)];
    expect(items.map((entry) => entry.getAttribute("data-outcome"))).toEqual(outcomes.map(({ kind }) => kind));
    for (const [index, row] of rows.entries()) {
      expect(items[index]?.textContent).toContain(row.label);
      if (outcomes[index]?.kind === "skipped") expect(items[index]?.textContent).toContain(skipped.reason);
    }
    if (checked.length > 0) {
      expect(element.querySelector(`${selector} [role="status"] p span`)?.textContent).toContain(String(checked.length));
    }
    element.querySelector<HTMLButtonElement>(`${selector} button`)!.click();
    await vi.waitFor(() => expect(element.querySelector(selector)).toBeNull());
    expect(instance.state.values.value.checked).toEqual(checked);
  } finally {
    unmount();
  }
});
