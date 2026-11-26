import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { appsSdkComponentCatalogEntrySchema } from "@ontomato/contracts/apps-sdk";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-authoring-expansion";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelHumanOperationDispatchResponse, PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import type {
  ProductPanelOperationsReadResponse,
  ProductPanelReadRequest,
  ProductPanelReadResponse,
} from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import { applicationPanelUseSchema, type DirectProjection, type ProductProjection } from "@ontomato/contracts/product-panels";
import type { DisplayPageController } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { components } from "../../../../../packages/apps-sdk/src/catalogue";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import {
  createDirectPanelInstance,
  directPanelContext,
  type PanelMemberReadRequest,
} from "../../../../../packages/apps-sdk/src/panel/direct";
import { directMountKey } from "../../../../../packages/apps-sdk/src/panel/direct-projection";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { usePanelOperation } from "../../../../../packages/apps-sdk/src/panel/panel-operation";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import { panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import schedulesSource from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.json";
import schedulesHtml from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.html?raw";
import schedulesModule from "../../../../../packages/platform-schedules/resources/builtin-panels/schedules/panel.mjs?raw";
import {
  humanIntents,
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  noOperations,
} from "./panel-frame";

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "call-c2-1",
};

const baseRecord = {
  domainId: "d",
  ownerId: "o",
  revision: 1,
  createdAt: "",
  updatedAt: "",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const readyOps = (value: Record<string, PanelOwnerOperationDescriptor>): ProductPanelOperationsReadResponse => ({
  status: "ready",
  value,
});

function mountHarness(options: {
  manifest: DirectPanelManifest;
  projections: Record<string, DirectProjection>;
  initial?: Record<string, unknown>;
  read: (request: PanelMemberReadRequest) => Promise<ProductPanelReadResponse | ProductPanelOperationsReadResponse>;
  autoMode?: boolean;
  dispatchResponse: (
    preparation: PanelHumanOperationPreparation,
  ) => PanelHumanOperationDispatchResponse | Promise<PanelHumanOperationDispatchResponse>;
  renderBody?: () => ReturnType<typeof h>[];
}) {
  let intentSeq = 0;
  const prepared: { intentId: string; operationId: string; invocation: unknown; agentRun: unknown }[] = [];
  const cancelled: { intentId: string; reason: unknown }[] = [];

  const prepare = vi.fn(async (
    operationId: string,
    invocation: unknown,
    _memberPath?: unknown,
    agentRun?: unknown,
  ): Promise<PanelHumanOperationPreparation> => {
    intentSeq += 1;
    const intentId = `6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
    prepared.push({ intentId, operationId, invocation, agentRun });
    const autoMode = options.autoMode ?? true;
    return {
      intentId,
      operationId,
      label: operationId,
      confirmation: { kind: "none" },
      autoMode,
      ...(autoMode ? {} : { questionId: `question-c2-${intentSeq}` }),
    };
  });

  const cancel = vi.fn(async (intentId: string, reason: unknown) => {
    cancelled.push({ intentId, reason });
  });

  const confirmOperation = vi.fn(async (
    preparation: PanelHumanOperationPreparation,
    hooks?: { onConfirmed?: () => void; skipDialog?: boolean },
  ) => {
    hooks?.onConfirmed?.();
    const response = await options.dispatchResponse(preparation);
    return { decision: "confirm" as const, response };
  });

  const instance = createDirectPanelInstance(options.manifest, {
    pageKey: "test-c2",
    url: () => "/test-c2",
    label: () => "Test C2",
    ...(options.initial ? { initial: options.initial as never } : {}),
    text: createPanelText({}, ref("en"), "en"),
    operations: {
      ...noOperations.operations,
      prepare: prepare as never,
      cancel: cancel as never,
    },
    confirmOperation: confirmOperation as never,
    read: options.read as never,
    readProjection: async (id) => {
      const found = options.projections[id];
      if (!found) throw new Error(`Unknown projection ${id}`);
      return found;
    },
    readComponentPackage: noOperations.readComponentPackage,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
  });

  const directMount = {
    instance,
    member: (member: string) => h(PanelMember, { instance, member }),
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });
  const app = createApp(defineComponent({
    setup() {
      provide(panelContextKey, directPanelContext(instance));
      provide(directMountKey, directMount as never);
      return () => h("div", options.renderBody
        ? options.renderBody()
        : Object.keys(options.manifest.members).map((member) => h(PanelMember, { instance, member, key: member })));
    },
  }));
  app.use(i18n);
  app.use(ElementPlus);
  app.mount(container);

  return {
    instance,
    prepared,
    cancelled,
    prepare,
    confirmOperation,
    unmount() {
      app.unmount();
      instance.markDisposed();
      container.remove();
    },
  };
}

describe("C2-1: mounted custom panel operation entries (usePanelOperation) & schedules panel", () => {
  afterEach(() => {
    leaveFrame();
    useApplicationCatalog().applications.value = [];
    document.body.innerHTML = "";
  });

  it("mounts custom panel action for component lifetime, filters bound params, enforces guards & 4-tuple confirmation, and runs shared settlement", async () => {
    const settled: { input: unknown; target: unknown; receiptKind: string }[] = [];
    const showButton = ref(true);
    const available = ref(true);
    const disabled = ref<boolean | string>(false);
    const externalBusy = ref(false);
    let humanRun!: (input?: Record<string, RuntimeJsonValue>) => Promise<unknown>;

    const CustomActionComponent = defineComponent({
      setup() {
        const action = usePanelOperation("customOp", "approve", {
          available,
          disabled,
          busy: externalBusy,
          onSettled(receipt, context) {
            settled.push({
              input: context.input,
              target: context.target,
              receiptKind: "decision" in receipt ? receipt.decision : "read",
            });
          },
        });
        humanRun = action.run;
        return () => h("button", { type: "button", onClick: () => void action.run({ reason: "human click" }) }, "Approve");
      },
    });

    const descriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "platform:ScheduledTask.approve",
      label: "Approve task",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string" },
          reason: { type: "string" },
        },
        required: ["reason"],
      },
      resultSchema: {},
    };

    const manifest: DirectPanelManifest = {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true, personal: false, external: false },
      },
      members: {
        customOp: {
          target: { projectionId: "proj-custom" },
          inputs: { task: { state: "selected" } },
        },
      },
    };
    const projections: Record<string, DirectProjection> = {
      "proj-custom": {
        ...baseRecord,
        id: "proj-custom",
        name: "CustomOp",
        componentId: "@ontomato/sdk:PanelData",
        inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
        data: {},
        outputs: {},
        config: {},
        operations: {
          approve: {
            operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.approve" },
            params: { mode: { literal: "strict" } },
          },
        },
      },
    };

    let nextAutoOutcome: Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"] = {
      kind: "success",
      data: { approved: true },
      message: "Approved",
    };

    // 1. Full-auto harness: verify param filtering, required input, guards, shared settlement, unknown outcome, and unmount cleanup.
    const harness = mountHarness({
      manifest,
      projections,
      initial: { selected: { className: SCHEDULED_TASK, primaryKey: "task-1" } },
      autoMode: true,
      read: async (req) => {
        if (req.operations) return { status: "ready", value: { approve: descriptor } };
        return { status: "empty" };
      },
      dispatchResponse: (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: nextAutoOutcome,
      }),
      renderBody: () => (showButton.value ? [h(CustomActionComponent)] : []),
    });

    try {
      await vi.waitFor(() => expect(harness.instance.operations.value.some((op) => op.id === "customOp.approve")).toBe(true));

      // Missing required interactive input -> input_required.
      const missing = await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { mode: "hacked" },
        agentRun: AGENT_RUN,
      });
      expect(missing).toMatchObject({ ok: false, reason: "input_required" });

      // Agent tries to override bound literal `mode` and smuggle undeclared `admin: true`:
      // bound param `mode: "strict"` wins, `admin` is stripped, `reason` passes through, and `onSettled` runs.
      const executed = await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "looks good", mode: "override-attempt", admin: true },
        expectedTarget: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" },
        agentRun: AGENT_RUN,
      });
      expect(executed).toMatchObject({ ok: true, kind: "executed", operation: "customOp.approve" });
      expect(harness.prepared[0]!.invocation).toEqual({
        call: {
          target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-1" },
          input: { reason: "looks good", mode: "strict" },
        },
      });
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({ input: { reason: "looks good", mode: "strict" }, receiptKind: "confirm" });

      // Human click goes through the exact same path and settlement.
      await humanRun({ reason: "human click" });
      expect(settled).toHaveLength(2);
      expect(settled[1]).toMatchObject({ input: { reason: "human click", mode: "strict" }, receiptKind: "confirm" });

      // Guards: unavailable, disabled (with reason), busy, wrong expectedTarget -> honestly refused.
      available.value = false;
      expect(await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "x" },
        agentRun: AGENT_RUN,
      })).toMatchObject({ ok: false, reason: "action_unavailable" });
      available.value = true;

      disabled.value = "Already approved";
      expect(await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "x" },
        agentRun: AGENT_RUN,
      })).toMatchObject({ ok: false, reason: "action_unavailable", message: "Already approved" });
      disabled.value = false;

      externalBusy.value = true;
      expect(await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "x" },
        agentRun: AGENT_RUN,
      })).toMatchObject({ ok: false, reason: "action_unavailable" });
      externalBusy.value = false;

      expect(await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "x" },
        expectedTarget: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-other" },
        agentRun: AGENT_RUN,
      })).toMatchObject({ ok: false, reason: "stale" });

      // Unknown outcome on custom action is reported honestly as kind: "unknown" (never "executed").
      nextAutoOutcome = { kind: "unknown", message: "Custom action transport dropped" };
      const customUnknown = await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "unknown check" },
        agentRun: AGENT_RUN,
      });
      expect(customUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "customOp.approve",
        message: "Custom action transport dropped",
      });
      nextAutoOutcome = { kind: "success", data: { approved: true }, message: "Approved" };

      // Unmounting the component unregisters the entry immediately (no offline fallback!).
      showButton.value = false;
      await nextTick();
      expect(await harness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "after unmount" },
        agentRun: AGENT_RUN,
      })).toMatchObject({ ok: false, reason: "action_not_found" });
    } finally {
      harness.unmount();
    }

    // 2. Default confirmation mode: verify 4-tuple staleness check on target change & unmount, plus settlement on confirm.
    showButton.value = true;
    available.value = true;
    disabled.value = false;
    externalBusy.value = false;
    settled.length = 0;

    const confirmHarness = mountHarness({
      manifest,
      projections,
      initial: { selected: { className: SCHEDULED_TASK, primaryKey: "task-1" } },
      autoMode: false,
      read: async (req) => {
        if (req.operations) return { status: "ready", value: { approve: descriptor } };
        return { status: "empty" };
      },
      dispatchResponse: (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "success", data: { approved: true }, message: "Approved" },
      }),
      renderBody: () => (showButton.value ? [h(CustomActionComponent)] : []),
    });

    try {
      await vi.waitFor(() => expect(confirmHarness.instance.operations.value.some((op) => op.id === "customOp.approve")).toBe(true));

      const awaitingStaleTarget = await confirmHarness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "confirm me" },
        agentRun: AGENT_RUN,
      });
      expect(awaitingStaleTarget).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaitingStaleTarget.ok || awaitingStaleTarget.kind !== "awaiting_confirmation") throw new Error("expected awaiting");

      // Switch selected task before user approves -> 4-tuple check rejects as stale and cancels intent!
      confirmHarness.instance.state.set("selected", { className: SCHEDULED_TASK, primaryKey: "task-2" });
      await nextTick();
      const staleResult = await awaitingStaleTarget.confirmation.dispatch();
      expect(staleResult).toMatchObject({ ok: false, reason: "stale" });
      expect(confirmHarness.cancelled).toHaveLength(1);
      expect(settled).toHaveLength(0);

      // Prepare on task-2 and approve without changes -> dispatches and runs panel's onSettled!
      const awaitingValid = await confirmHarness.instance.executeAction({
        operation: "customOp.approve",
        input: { reason: "confirm task-2" },
        agentRun: AGENT_RUN,
      });
      expect(awaitingValid).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaitingValid.ok || awaitingValid.kind !== "awaiting_confirmation") throw new Error("expected awaiting");

      const confirmed = await awaitingValid.confirmation.dispatch();
      expect(confirmed).toMatchObject({ ok: true, intentId: awaitingValid.intentId });
      expect(settled).toHaveLength(1);
      expect(settled[0]).toMatchObject({
        target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "task-2" },
        input: { reason: "confirm task-2", mode: "strict" },
      });
    } finally {
      confirmHarness.unmount();
    }
  });

  it("exposes schedules panel's opEnable.setEnabled, opRunNow.runNow, and opDelete.delete to page_action with shared settlement", async () => {
    const application = catalogFixture().find((app) => app.id === "schedules")!;
    const use = applicationPanelUseSchema.parse(application.panelUses![0]!);
    const taskId = "10000000-0000-4000-8000-000000000001";
    const taskId2 = "10000000-0000-4000-8000-000000000002";
    const activeRunId = "20000000-0000-4000-8000-000000000099";
    const deleteMessage = "Task “Nightly test” deleted";

    const row1 = {
      primaryKey: taskId,
      label: "Nightly test",
      fields: {
        application: "agents",
        applicationName: "Agents",
        settings: "Agent: Nightly",
        frequency: "Every Monday",
        state: "off",
        stateLabel: "Switched off",
        enabled: false,
        revision: 1,
        pauseCode: "",
        nextRun: "",
        timeZone: "UTC",
        notifyEmail: "",
        lastRun: "completed",
        lastRunAt: "2026-11-21T00:00:00Z",
        lastRunSummary: "",
        latestResultPath: "",
      },
      tones: { state: "info" as const, stateLabel: "info" as const, lastRun: "success" as const },
      outputs: {
        revision: 1,
        enabled: false,
        paused: false,
        pauseCode: "",
        latestResultPath: "",
        isRunning: false,
      },
    };
    const row2 = {
      ...row1,
      primaryKey: taskId2,
      label: "Backup job",
    };

    expect(schedulesModule).not.toContain("usePanelData");

    const objectTypes = Object.fromEntries(Object.entries(platformObjectTypes).map(([type, entry]) => [
      type,
      platformTypeTableEntrySchema.parse({
        ...entry,
        operations: entry.operations?.map((id) => {
          const form = id === "platform:ScheduledTask.save" || id === "platform:ScheduledTask.create";
          return {
            id,
            kind: form ? "form.save" : "action",
            effect: "write",
            batch: false,
            inputSchema: {},
            target: form ? { source: "draft" } : { source: "input", input: type === "platform:Application" ? "application" : "task" },
          };
        }),
      }),
    ]));
    const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(schedulesSource.manifest);
    const catalogue = components.map((component) => appsSdkComponentCatalogEntrySchema.parse({
      ...component,
      ports: { props: [], events: [], slots: [] },
    }));
    const projections = new Map<string, ProductProjection>();
    const members = Object.fromEntries(Object.entries(authoring).map(([name, definition]) => {
      if (!("component" in definition)) return [name, definition];
      const { projection, placement } = expandPanelAuthoringMember(name, definition, {
        state: manifest.state,
        typeTable: { objectTypes },
        components: catalogue,
      });
      projections.set(definition.id!, {
        ...projection,
        id: definition.id!,
        name,
        description: name,
        visibility: "platform",
        domainId: null,
        ownerId: null,
        editable: false,
        revision: 1,
        createdAt: "2026-11-21T00:00:00Z",
        updatedAt: "2026-11-21T00:00:00Z",
      });
      return [name, { ...placement, target: { projectionId: definition.id! } }];
    }));
    const panel = {
      ...panelRecord(use.panelId, "Scheduled tasks", definePanel({ ...manifest, members })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false as const,
      content: { html: schedulesHtml, module: schedulesModule, messages: schedulesSource.content.messages },
    };

    let runNowMode: "running" | "task_running" = "running";
    const dispatchedOps: { operationId: string; call: unknown }[] = [];
    const writes = humanIntents(
      (operation, call) => {
        dispatchedOps.push({ operationId: operation, call });
        if (operation === "opEnable.setEnabled") {
          return { kind: "success", data: { id: taskId, enabled: true } };
        }
        if (operation === "opRunNow.runNow") {
          if (runNowMode === "task_running") {
            return {
              kind: "refusal",
              code: "TASK_RUNNING",
              message: "Task is already running",
              details: { activeRunId },
            };
          }
          return { kind: "success", data: { id: "run-new", taskId, status: "running", error: null } };
        }
        if (operation === "opDelete.delete") {
          return { kind: "success", message: deleteMessage, data: { id: taskId } };
        }
        return { kind: "success", data: {} };
      },
      undefined,
      {
        admitted(member, inputs) {
          if (member === "opEnable" && inputs.task) {
            return {
              setEnabled: {
                kind: "action",
                handlerRef: "platform:ScheduledTask.setEnabled",
                effect: "write",
                label: "Set enabled",
                batch: false,
                target: { source: "input", input: "task" },
                inputSchema: {
                  type: "object",
                  properties: { enabled: { type: "boolean" }, revision: { type: "integer", minimum: 1 } },
                  required: ["enabled", "revision"],
                },
                resultSchema: {},
              },
            };
          }
          if (member === "opRunNow" && inputs.task) {
            return {
              runNow: {
                kind: "action",
                handlerRef: "schedules.runNow",
                effect: "write",
                label: "Run now",
                batch: false,
                target: { source: "input", input: "task" },
                inputSchema: { type: "object", properties: {} },
                resultSchema: {},
              },
            };
          }
          if (member === "opDelete" && inputs.task) {
            return {
              delete: {
                kind: "action",
                handlerRef: "platform:ScheduledTask.delete",
                effect: "write",
                label: "Delete task",
                batch: false,
                target: { source: "input", input: "task" },
                inputSchema: {
                  type: "object",
                  properties: { revision: { type: "integer", minimum: 1 } },
                  required: ["revision"],
                },
                resultSchema: {},
              },
            };
          }
          if (member === "renew") {
            return {
              renewCredential: {
                kind: "action",
                handlerRef: "schedules.renewCredential",
                effect: "write",
                label: "Renew credential",
                batch: false,
                target: { source: "input", input: "application" },
                inputSchema: {},
                resultSchema: {},
              },
            };
          }
          return {};
        },
      },
    );

    installPlatform((request) => {
      const { path } = request;
      if (path === "/api/data-query/platform/applications/schedules/panel-uses") {
        return Response.json({ data: { applicationId: application.id, entry: application.entry, panelUses: [use] } });
      }
      if (path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
      if (path === `/api/product-panels/${panel.id}/snapshot`) {
        return panelSnapshot(panel, Object.fromEntries(projections), request);
      }
      if (path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(path.split("/").at(-1)!) });
      }
      if (path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        if ("operations" in body) return writes(request)!;
        const member = body.memberPath[0]!.member;
        if (member === "appFilter" && body.dataName === "counts") {
          return Response.json({
            status: "ready",
            value: [
              { key: "", label: "All", count: 2 },
              { key: "agents", label: "Agents", count: 2 },
            ],
          });
        }
        if (member === "tasks" && body.dataName === "rows") {
          return Response.json({ status: "ready", value: [row1, row2] });
        }
        if (member === "history" && body.dataName === "rows") {
          return Response.json({ status: "ready", value: { rows: [] } });
        }
        if (member === "focus" && body.dataName === "record") {
          return Response.json({
            status: "ready",
            value: {
              primaryKey: activeRunId,
              label: "Manual · Running",
              fields: { status: "Running", trigger: "Manual", startedAt: "2026-11-21T00:00:00Z" },
              tones: { status: "info" },
              outputs: { resultPath: "", isRunning: true },
            },
          });
        }
        switch (body.dataName) {
          case "record": {
            const pk = (body.inputs?.target as { primaryKey?: string } | undefined)?.primaryKey;
            return Response.json({ status: "ready", value: pk === taskId2 ? row2 : row1 });
          }
          case "form": return Response.json({
            status: "ready",
            value: {
              fields: [],
              values: { task: { title: "Nightly test", appId: "agents", timeZone: "UTC" } },
              errors: [],
              revision: 1,
              save: { method: "PUT", path: `/scheduled-tasks/${taskId}`, bodySchema: {} },
            },
          });
          case "createForm": return Response.json({
            status: "ready",
            value: {
              fields: [{ path: "/task/appId", label: "App", control: { kind: "select", options: [{ value: "agents", label: "Agents", disabled: false }] } }],
              values: { task: { timeZone: "UTC" } },
              errors: [],
              revision: 1,
            },
          });
        }
      }
      return writes(request) ?? nothingAt(request);
    });

    useApplicationCatalog().applications.value = [application];
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { ...platformRoutes.layout, component: RouterView, children: [] },
        unknownAddressRoute,
      ],
    });
    router.beforeEach(detailSelectionGuard(DETAIL_SELECTIONS));
    router.beforeEach(panelEntryGuard(router));

    let controller: DisplayPageController | null = null;
    const latestContext = ref<{ state?: Record<string, unknown> } | null>(null);
    await router.push("/schedules");
    const mounted = mountPlatformPage(
      () => h(PanelApplicationRoute, {
        applicationId: "schedules",
        address: "/schedules",
        registerPageController: (next: DisplayPageController) => {
          controller = next;
          return () => {
            if (controller === next) controller = null;
          };
        },
        onContext: (ctx: { state?: Record<string, unknown> } | null) => {
          latestContext.value = ctx;
        },
      }),
      router,
    );

    try {
      await vi.waitFor(() => expect(controller?.executeAction).toBeTypeOf("function"));
      await vi.waitFor(() => expect(mounted.element.querySelectorAll(".schedules-list-col .sdk-sts-card")).toHaveLength(2));

      // 1. With no task selected, all three custom operations are rejected as action_unavailable (not action_not_found).
      for (const operation of ["opEnable.setEnabled", "opRunNow.runNow", "opDelete.delete"]) {
        const res = await controller!.executeAction!({ operation, agentRun: AGENT_RUN });
        expect(res).toMatchObject({ ok: false, reason: "action_unavailable" });
      }

      // 2. Select task-1 via live state controller (same as `present`).
      controller!.applyState({ selectedTask: { className: SCHEDULED_TASK, primaryKey: taskId } });

      // Wait for detailHeader and operations read on selected task to settle.
      await vi.waitFor(async () => {
        const missing = await controller!.executeAction!({
          operation: "opEnable.setEnabled",
          input: {},
          agentRun: AGENT_RUN,
        });
        expect(missing).toMatchObject({ ok: false, reason: "input_required" });
      });

      // 3. opEnable.setEnabled succeeds and triggers panel settlement toast.
      const enabledRes = await controller!.executeAction!({
        operation: "opEnable.setEnabled",
        input: { enabled: true, revision: 1 },
        agentRun: AGENT_RUN,
      });
      expect(enabledRes).toMatchObject({ ok: true, kind: "executed", operation: "opEnable.setEnabled" });
      expect(dispatchedOps.at(-1)).toMatchObject({
        operationId: "opEnable.setEnabled",
        call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: taskId }, input: { enabled: true, revision: 1 } },
      });

      // 4. opRunNow.runNow succeeds and triggers panel settlement toast.
      const runNowRes = await controller!.executeAction!({
        operation: "opRunNow.runNow",
        input: {},
        agentRun: AGENT_RUN,
      });
      expect(runNowRes).toMatchObject({ ok: true, kind: "executed", operation: "opRunNow.runNow" });
      expect(dispatchedOps.at(-1)).toMatchObject({
        operationId: "opRunNow.runNow",
        call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: taskId }, input: {} },
      });

      // 5. opRunNow.runNow when owner refuses with TASK_RUNNING -> reports failed with TASK_RUNNING code AND runs panel settlement setting runId.
      runNowMode = "task_running";
      const runningRes = await controller!.executeAction!({
        operation: "opRunNow.runNow",
        input: {},
        agentRun: AGENT_RUN,
      });
      expect(runningRes).toMatchObject({ ok: false, reason: "failed", code: "TASK_RUNNING", operation: "opRunNow.runNow" });
      await vi.waitFor(() => expect(latestContext.value?.state?.runId).toBe(activeRunId));

      // 5b. renew.renewCredential uses { entry: false } and is NOT exposed as a page_action entry.
      const renewRes = await controller!.executeAction!({
        operation: "renew.renewCredential",
        input: {},
        agentRun: AGENT_RUN,
      });
      expect(renewRes).toMatchObject({ ok: false, reason: "action_not_found", operation: "renew.renewCredential" });

      // 6. opDelete.delete succeeds AND triggers panel settlement (clears selectedTask & runId, shows delete toast).
      const deleteRes = await controller!.executeAction!({
        operation: "opDelete.delete",
        input: { revision: 1 },
        agentRun: AGENT_RUN,
      });
      expect(deleteRes).toMatchObject({ ok: true, kind: "executed", operation: "opDelete.delete" });
      await vi.waitFor(() => expect(latestContext.value?.state?.selectedTask).toBeNull());
      await vi.waitFor(() =>
        expect([...document.querySelectorAll(".el-message__content")].map((el) => el.textContent)).toContain(deleteMessage),
      );
    } finally {
      mounted.app.unmount();
    }
  }, 15_000);
});

describe("C2-2: owner unknown / refusal / failure outcomes never wrapped as executed", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports single unknown, full-auto batch unknown, and refusal honestly on OperationButton and ObjectHeader", async () => {
    let nextResponse!: (prep: PanelHumanOperationPreparation) => PanelHumanOperationDispatchResponse;
    const batchDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "platform:ScheduledTask.batchStatus",
      label: "Update status",
      effect: "write",
      batch: true,
      target: { source: "input", input: "tasks" },
      inputSchema: {},
      resultSchema: {},
    };
    const singleDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "platform:ScheduledTask.archive",
      label: "Archive",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {},
      resultSchema: {},
    };

    const manifest: DirectPanelManifest = {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true, personal: false, external: false },
        checked: { type: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } }, deepLink: false, personal: false, external: false },
      },
      members: {
        batchBtn: {
          target: { projectionId: "proj-batch" },
          inputs: { tasks: { state: "checked" } },
        },
        singleBtn: {
          target: { projectionId: "proj-single" },
          inputs: { task: { state: "selected" } },
        },
        header: {
          target: { projectionId: "proj-header" },
          inputs: { task: { state: "selected" } },
        },
      },
    };
    const projections: Record<string, DirectProjection> = {
      "proj-batch": {
        ...baseRecord,
        id: "proj-batch",
        name: "BatchBtn",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: { tasks: { kind: "list", items: { kind: "object", objectType: SCHEDULED_TASK } } },
        data: {},
        outputs: {},
        config: { operation: "batchStatus" },
        operations: {
          batchStatus: { operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.batchStatus" } },
        },
      },
      "proj-single": {
        ...baseRecord,
        id: "proj-single",
        name: "SingleBtn",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
        data: {},
        outputs: {},
        config: { operation: "archive" },
        operations: {
          archive: { operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.archive" } },
        },
      },
      "proj-header": {
        ...baseRecord,
        id: "proj-header",
        name: "Header",
        componentId: "@ontomato/sdk:ObjectHeader",
        inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
        data: {},
        outputs: {},
        config: { title: "Task Header", maxVisibleOperations: 0 },
        operations: {
          archive: { operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.archive" } },
        },
      },
    };

    const harness = mountHarness({
      manifest,
      projections,
      initial: {
        selected: { className: SCHEDULED_TASK, primaryKey: "t-1" },
        checked: [
          { className: SCHEDULED_TASK, primaryKey: "t-1" },
          { className: SCHEDULED_TASK, primaryKey: "t-2" },
        ],
      },
      autoMode: true,
      read: async (req) => {
        if (req.operations) {
          const m = req.memberPath[0]!.member;
          if (m === "batchBtn") return readyOps({ batchStatus: batchDescriptor });
          return readyOps({ archive: singleDescriptor });
        }
        return { status: "empty" };
      },
      dispatchResponse: (prep) => nextResponse(prep),
    });

    try {
      await vi.waitFor(() => expect(harness.instance.operations.value.length).toBe(3));
      await vi.waitFor(() => expect(document.querySelectorAll(".sdk-operation-button").length).toBe(2));
      await vi.waitFor(() => expect(document.querySelectorAll(".sdk-object-header-more").length).toBe(1));

      // 1. Single OperationButton returning unknown -> kind: "unknown", NOT executed!
      nextResponse = (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "unknown", message: "Upstream request timed out" },
      });
      const singleUnknown = await harness.instance.executeAction({
        operation: "singleBtn.archive",
        agentRun: AGENT_RUN,
      });
      expect(singleUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "singleBtn.archive",
        intentId: harness.prepared.at(-1)!.intentId,
        outcome: { kind: "unknown", message: "Upstream request timed out" },
        message: "Upstream request timed out",
      });

      // 2. Batch OperationButton with 1 success + 1 unknown -> kind: "unknown", NOT executed!
      nextResponse = (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: {
          kind: "batch",
          items: [
            { target: { objectType: SCHEDULED_TASK, primaryKey: "t-1" }, outcome: { kind: "success", data: {} } },
            { target: { objectType: SCHEDULED_TASK, primaryKey: "t-2" }, outcome: { kind: "unknown", message: "Connection reset on t-2" } },
          ],
        },
      });
      const batchUnknown = await harness.instance.executeAction({
        operation: "batchBtn.batchStatus",
        agentRun: AGENT_RUN,
      });
      expect(batchUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "batchBtn.batchStatus",
        intentId: harness.prepared.at(-1)!.intentId,
        message: "Connection reset on t-2",
      });

      // 3. Single OperationButton returning refusal -> reason: "failed", NOT executed!
      nextResponse = (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "refusal", code: "CONFLICT", message: "Already archived" },
      });
      const singleRefusal = await harness.instance.executeAction({
        operation: "singleBtn.archive",
        agentRun: AGENT_RUN,
      });
      expect(singleRefusal).toMatchObject({
        ok: false,
        reason: "failed",
        operation: "singleBtn.archive",
        message: "Already archived",
      });

      // 4. ObjectHeader overflow ("More") action returning unknown -> kind: "unknown", NOT executed!
      nextResponse = (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "unknown", message: "Header action lost connection" },
      });
      const headerUnknown = await harness.instance.executeAction({
        operation: "header.archive",
        agentRun: AGENT_RUN,
      });
      expect(headerUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "header.archive",
        message: "Header action lost connection",
      });
    } finally {
      harness.unmount();
    }
  });

  it("reports unknown honestly on ObjectList row action, ObjectForm save, and deferred confirmation dispatch", async () => {
    const saveDescriptor: PanelOwnerOperationDescriptor = {
      kind: "form.save",
      handlerRef: `${SCHEDULED_TASK}.save`,
      label: "Save",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {},
      resultSchema: {},
    };
    const rowOpDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: `${SCHEDULED_TASK}.delete`,
      label: "Delete",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {},
      resultSchema: {},
    };
    const formDesc: PanelFormDescription = {
      revision: 1,
      fields: [{ path: "/title", label: "Title", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false }],
      values: { title: "Original" },
      errors: [],
      save: { method: "PUT", path: "/tasks/t-1", bodySchema: {} },
    };

    const manifest: DirectPanelManifest = {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true, personal: false, external: false },
      },
      members: {
        list: { target: { projectionId: "proj-list" } },
        form: { target: { projectionId: "proj-form" }, inputs: { task: { state: "selected" } } },
      },
    };
    const projections: Record<string, DirectProjection> = {
      "proj-list": {
        ...baseRecord,
        id: "proj-list",
        name: "List",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        data: {
          rows: {
            source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
            read: "list",
            params: {},
          },
        },
        outputs: {},
        config: {
          rowActions: {
            items: [{ kind: "operation", operation: "delete" }],
          },
        },
        operations: {
          delete: {
            operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.delete` },
            target: { row: true },
          },
        },
      },
      "proj-form": {
        ...baseRecord,
        id: "proj-form",
        name: "Form",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } },
        data: {
          form: {
            source: { object: { input: "task" } },
            read: "form",
            params: {},
          },
        },
        outputs: {},
        config: {},
        operations: {
          save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } },
        },
      },
    };

    // 1. Full-auto mode: ObjectList row action & ObjectForm save returning unknown -> kind: "unknown".
    const autoHarness = mountHarness({
      manifest,
      projections,
      initial: { selected: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      autoMode: true,
      read: async (req) => {
        if (req.operations) {
          return req.memberPath[0]!.member === "list"
            ? readyOps({ delete: rowOpDescriptor })
            : readyOps({ save: saveDescriptor });
        }
        if (req.dataName === "rows") {
          return ready([{ primaryKey: "t-1", label: "Task 1", fields: {} }]);
        }
        if (req.dataName === "form") {
          return ready(formDesc);
        }
        return { status: "empty" };
      },
      dispatchResponse: (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "unknown", message: "Owner reply lost in transit" },
      }),
    });

    try {
      await vi.waitFor(() => expect(autoHarness.instance.forms.snapshot("form")?.dirty).toBe(false));
      await vi.waitFor(() => expect(document.body.textContent).toContain("Task 1"));
      await vi.waitFor(() => expect(autoHarness.instance.operations.value.some((op) => op.id === "list.delete")).toBe(true));

      const rowUnknown = await autoHarness.instance.executeAction({
        operation: "list.delete",
        rowKey: "t-1",
        agentRun: AGENT_RUN,
      });
      expect(rowUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "list.delete",
        message: "Owner reply lost in transit",
      });

      const fill = await autoHarness.instance.fillForm({ member: "form", values: { "/title": "Edited" } });
      expect(fill).toMatchObject({ ok: true });
      const formUnknown = await autoHarness.instance.executeAction({
        operation: "form.save",
        agentRun: AGENT_RUN,
      });
      expect(formUnknown).toMatchObject({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "form.save",
        message: "Owner reply lost in transit",
      });
    } finally {
      autoHarness.unmount();
    }

    // 2. Default confirmation mode: confirmed dispatch returning unknown -> reason: "unknown" (not ok: true).
    const confirmHarness = mountHarness({
      manifest,
      projections,
      initial: { selected: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      autoMode: false,
      read: async (req) => {
        if (req.operations) {
          return req.memberPath[0]!.member === "list"
            ? readyOps({ delete: rowOpDescriptor })
            : readyOps({ save: saveDescriptor });
        }
        if (req.dataName === "rows") {
          return ready([{ primaryKey: "t-1", label: "Task 1", fields: {} }]);
        }
        if (req.dataName === "form") {
          return ready(formDesc);
        }
        return { status: "empty" };
      },
      dispatchResponse: (prep) => ({
        kind: "dispatched",
        intentId: prep.intentId,
        outcome: { kind: "unknown", message: "Owner reply lost after confirmation" },
      }),
    });

    try {
      await vi.waitFor(() => expect(confirmHarness.instance.forms.snapshot("form")?.dirty).toBe(false));
      await vi.waitFor(() => expect(document.body.textContent).toContain("Task 1"));
      await vi.waitFor(() => expect(confirmHarness.instance.operations.value.some((op) => op.id === "list.delete")).toBe(true));

      const awaitingRow = await confirmHarness.instance.executeAction({
        operation: "list.delete",
        rowKey: "t-1",
        agentRun: AGENT_RUN,
      });
      expect(awaitingRow).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaitingRow.ok || awaitingRow.kind !== "awaiting_confirmation") throw new Error("expected awaiting");
      expect(await awaitingRow.confirmation.dispatch()).toMatchObject({
        ok: false,
        intentId: awaitingRow.intentId,
        reason: "unknown",
        message: "Owner reply lost after confirmation",
      });

      await confirmHarness.instance.fillForm({ member: "form", values: { "/title": "Edited" } });
      const awaitingForm = await confirmHarness.instance.executeAction({
        operation: "form.save",
        agentRun: AGENT_RUN,
      });
      expect(awaitingForm).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!awaitingForm.ok || awaitingForm.kind !== "awaiting_confirmation") throw new Error("expected awaiting");
      expect(await awaitingForm.confirmation.dispatch()).toMatchObject({
        ok: false,
        intentId: awaitingForm.intentId,
        reason: "unknown",
        message: "Owner reply lost after confirmation",
      });
    } finally {
      confirmHarness.unmount();
    }
  });
});
