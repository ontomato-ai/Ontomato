import { vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

export const ORDER = "CustomerOrder";

export const baseRecord = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

export const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

export function mountCreatePanel(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>;
  initial?: Record<string, unknown>;
}) {
  const reads: PanelMemberReadRequest[] = [];
  const prepared: [string, unknown][] = [];
  const savedEvents: unknown[] = [];
  const recordedDrafts: { link: unknown; created: string }[] = [];
  let outcome: unknown = {
    kind: "success",
    data: { result: "{\"ok\":true}", affects: [ORDER] },
    affected: { objects: [], objectTypes: [ORDER] },
  };

  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push([operationId, invocation]);
    return {
      intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d99",
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
    };
  });

  const instance = createDirectPanelInstance(options.manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "customer-orders",
    url: () => "/customer-orders",
    label: () => "Customer Orders",
    initial: (options.initial ?? {}) as never,
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare },
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => {
      const result = {
        decision: "confirm" as const,
        response: { kind: "dispatched" as const, intentId, outcome: outcome as never },
      };
      const maybeAffected = (outcome as { kind?: string; affected?: unknown })?.kind === "success"
        ? (outcome as { affected?: unknown }).affected
        : undefined;
      if (maybeAffected) instance.refresh(maybeAffected as never);
      return result;
    },
    recordDraftCreated: async (link, created) => {
      recordedDrafts.push({ link, created });
    },
    reportDraftError: () => {},
    readProjection: async (id) => options.projections[id]!,
    read: async (request) => {
      reads.push(request);
      return options.answer(request);
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const memberKeys = Object.keys(options.manifest.members);
  const app = createApp({
    render: () => h(
      "div",
      memberKeys.map((member) =>
        h(PanelMember, {
          instance,
          member,
          onSaved: (payload: unknown) => {
            savedEvents.push(payload);
          },
        })),
    ),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  return {
    instance,
    element,
    reads,
    prepared,
    savedEvents,
    recordedDrafts,
    setOutcome: (next: unknown) => { outcome = next; },
    unmount: () => app.unmount(),
  };
}
