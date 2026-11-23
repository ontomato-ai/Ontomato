import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "../../../../../packages/foundation-ui/node_modules/@codemirror/view";
import { createApp, h, nextTick, provide, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
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
import { FEEDBACK_RECORD, SCHEDULED_TASK, SKILL } from "@ontomato/contracts/panel-client-requests";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { DirectProjection, ProductProjection } from "@ontomato/contracts/product-panels";
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
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { DETAIL_SELECTIONS, detailSelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import { panelEntryGuard, unknownAddressRoute } from "../../../../../packages/platform-web/src/panel-entries";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import feedbackSource from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.json";
import feedbackHtml from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.html?raw";
import feedbackModule from "../../../../../packages/platform-admin/resources/builtin-panels/feedback/panel.mjs?raw";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  noOperations,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
} from "./panel-frame";

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  toolCallId: "tool-call-d2",
};

const baseProjection = {
  description: "",
  visibility: "domain" as const,
  domainId: "d",
  ownerId: "u",
  editable: false,
  revision: 1,
  createdAt: "2026-11-24T00:00:00Z",
  updatedAt: "2026-11-24T00:00:00Z",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const readyOps = (value: Record<string, PanelOwnerOperationDescriptor>): ProductPanelOperationsReadResponse => ({
  status: "ready",
  value,
});

function createI18nPlugin() {
  return createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages: { en: publicEn },
  });
}

describe("D2 regression suite: unified usePanelOperation, ObjectForm & ObjectList guards", () => {
  afterEach(() => {
    leaveFrame();
    useApplicationCatalog().applications.value = [];
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("mounts builtin feedback panel and executes exportCsv.export via unified usePanelOperation", async () => {
    const application = catalogFixture().find((app) => app.id === "settings")!;
    const use = application.panelUses?.find((entry) => entry.path === "/settings/feedback")
      ?? {
        id: "feedback-main",
        path: "/settings/feedback",
        pageKey: "feedback",
        panelId: "builtin-product-feedback-d2",
        access: { kind: "domain-member" as const },
      };
    const feedbackApp = {
      ...application,
      panelUses: application.panelUses?.some((entry) => entry.path === "/settings/feedback")
        ? application.panelUses
        : [...(application.panelUses ?? []), use],
    };
    const objectTypes = Object.fromEntries(Object.entries(platformObjectTypes).map(([type, entry]) => [
      type,
      platformTypeTableEntrySchema.parse({
        ...entry,
        operations: entry.operations?.map((id) => ({
          id,
          kind: "action",
          effect: id === "feedback.export" ? "read" : "write",
          batch: false,
          inputSchema: {},
          target: id === "feedback.export" ? { source: "none" } : { source: "input", input: "target" },
        })),
      }),
    ]));

    const { members: authoring, ...manifest } = panelAuthoringManifestSchema.parse(feedbackSource.manifest);
    const catalogue = components.map((component) => appsSdkComponentCatalogEntrySchema.parse({
      ...component,
      ports: { props: [], events: [], slots: [] },
    }));
    const projections = new Map<string, ProductProjection>();
    const members = Object.fromEntries(Object.entries(authoring).map(([name, definition]) => {
      if (!("component" in definition)) throw new Error(`Expected authored projection for ${name}`);
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
        createdAt: "2026-11-24T00:00:00Z",
        updatedAt: "2026-11-24T00:00:00Z",
      });
      return [name, { ...placement, target: { projectionId: definition.id! } }];
    }));
    const panel = {
      ...panelRecord(use.panelId, "User feedback", definePanel({ ...manifest, members })),
      visibility: "platform" as const,
      domainId: null,
      ownerId: null,
      editable: false as const,
      content: { html: feedbackHtml, module: feedbackModule, messages: feedbackSource.content.messages },
    };

    const exportCalls: Array<Record<string, unknown>> = [];
    installPlatform(async (request) => {
      if (request.path === `/api/data-query/platform/applications/${application.id}/panel-uses`) {
        return Response.json({
          data: {
            applicationId: application.id,
            entry: application.entry,
            panelUses: [use],
          },
        });
      }
      if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
      if (request.path === `/api/product-panels/${panel.id}/snapshot`) {
        return panelSnapshot(panel, Object.fromEntries(projections), request);
      }
      if (request.path.startsWith("/api/product-projections/")) {
        return Response.json({ projection: projections.get(request.path.split("/").at(-1)!) });
      }
      if (request.path === "/api/product-panels/read") {
        const body = request.body as ProductPanelReadRequest;
        const member = body.memberPath[0]?.member;
        if ("operations" in body) {
          if (member === "exportCsv") {
            return Response.json({
              status: "ready",
              value: {
                export: {
                  kind: "action",
                  handlerRef: "feedback.export",
                  label: "Export CSV",
                  effect: "read",
                  target: { source: "none" },
                  inputSchema: {},
                  resultSchema: {},
                  batch: false,
                },
              },
            });
          }
          return Response.json({ status: "ready", value: {} });
        }
        if (member === "list") {
          return Response.json({
            status: "ready",
            value: {
              rows: [
                {
                  primaryKey: "fb-1",
                  className: FEEDBACK_RECORD,
                  label: "Great answer",
                  fields: { userId: "u1", userInput: "Great answer", rating: "up", sourceType: "chat" },
                },
              ],
              total: 1,
            },
          });
        }
        return Response.json({ status: "ready", value: [] });
      }
      if (request.path === "/api/panel-operations/read") {
        exportCalls.push(request.body as Record<string, unknown>);
        return Response.json({ kind: "json", value: { exported: true } });
      }
      return nothingAt(request);
    });

    useApplicationCatalog().applications.value = [feedbackApp];
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
    await router.push("/settings/feedback?search=invoice&sourceType=chat&rating=up");
    const mounted = mountPlatformPage(
      () => h(PanelApplicationRoute, {
        applicationId: application.id,
        address: "/settings/feedback?search=invoice&sourceType=chat&rating=up",
        registerPageController: (next: DisplayPageController) => {
          controller = next;
          return () => {
            if (controller === next) controller = null;
          };
        },
      }),
      router,
    );

    try {
      await vi.waitFor(() => expect(controller).not.toBeNull(), { timeout: 5000 });
      await vi.waitFor(() => expect(mounted.element.textContent).toContain("Export CSV"), { timeout: 5000 });

      const result = await controller!.executeAction!({
        operation: "exportCsv.export",
        input: {},
        agentRun: AGENT_RUN,
      });
      expect(result).toMatchObject({ ok: true, kind: "executed", operation: "exportCsv.export" });
      expect(exportCalls).toHaveLength(1);
      expect(exportCalls[0]).toMatchObject({
        operationId: "exportCsv.export",
        call: {
          input: expect.objectContaining({
            search: "invoice",
            sourceType: "chat",
            rating: "up",
          }),
        },
      });
    } finally {
      mounted.app.unmount();
    }
  }, 15_000);

  it("ObjectForm distinguishes user-edited vs agent-filled fields, tracks editGeneration & activeInvalid, supports auto-mode discard, rotates formInstanceId, and preserves partial refusal", async () => {
    let localAutoMode = false;
    let claimResult: { ok: boolean; intentId?: string; message?: string } = { ok: true };
    let nextDispatchOutcome: Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"] = {
      kind: "success",
      data: { ok: true },
    };
    let localConfirmSeq = 0;
    let intentSeq = 0;

    const saveDescriptor: PanelOwnerOperationDescriptor = {
      kind: "form.save",
      handlerRef: "platform:ScheduledTask.save",
      label: "Save task",
      effect: "write",
      batch: false,
      target: { source: "input", input: "task" },
      inputSchema: {},
      resultSchema: {},
    };

    const formById: Record<string, { name: string; note: string; payload: Record<string, unknown> }> = {
      "t-1": { name: "Task A", note: "Note A", payload: { enabled: true } },
      "t-2": { name: "Task B", note: "Note B", payload: { enabled: false } },
    };

    const manifest: DirectPanelManifest = {
      state: {
        selected: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true, personal: false, external: false },
      },
      members: {
        form: {
          target: { projectionId: "proj-form" },
          inputs: { task: { state: "selected" } },
        },
      },
    };
    const projection: DirectProjection = {
      ...baseProjection,
      id: "proj-form",
      name: "Task form",
      componentId: "@ontomato/sdk:ObjectForm",
      inputs: {
        task: { kind: "object", objectType: SCHEDULED_TASK },
        values: { kind: "json" },
        changedField: { kind: "scalar", type: "string" },
      },
      data: {
        form: {
          source: { object: { input: "task" } },
          read: "form",
          params: { values: { input: "values" }, changedField: { input: "changedField" } },
        },
      },
      outputs: {},
      config: {},
      operations: {
        save: { operation: { kind: "PlatformOperation", id: "platform:ScheduledTask.save" }, target: { input: "task" } },
      },
    };

    const instance = createDirectPanelInstance(manifest, {
      pageKey: "tasks-d2",
      url: () => "/tasks-d2",
      label: () => "Tasks D2",
      initial: { selected: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
      text: createPanelText({}, ref("en"), "en"),
      read: async (req: PanelMemberReadRequest) => {
        if (req.operations) return readyOps({ save: saveDescriptor });
        const pk = (req.inputs?.task as { primaryKey?: string } | undefined)?.primaryKey
          ?? (instance.state.values.value.selected as { primaryKey?: string } | null)?.primaryKey
          ?? "t-1";
        const vals = formById[pk] ?? formById["t-1"]!;
        return ready({
          fields: [
            { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: { type: "string" }, required: true, readOnly: false },
            { path: "/note", label: "Note", control: { kind: "text" }, valueSchema: { type: "string" }, required: false, readOnly: false },
            { path: "/payload", label: "Payload", control: { kind: "code", language: "json" }, valueSchema: { type: "object" }, required: false, readOnly: false },
          ],
          values: structuredClone(vals),
          errors: [],
          revision: 1,
          save: { method: "PUT", path: `/tasks/${pk}`, bodySchema: {}, draftOperation: "task.save" },
        });
      },
      readProjection: async () => projection,
      operations: {
        ...noOperations.operations,
        prepare: async (operationId: string): Promise<PanelHumanOperationPreparation> => {
          intentSeq += 1;
          return {
            intentId: `6f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`,
            operationId,
            label: "Save task",
            confirmation: { kind: "none" },
            autoMode: false,
            questionId: `question-save-${intentSeq}`,
          };
        },
        cancel: async () => {},
        requestLocalConfirmation: async (input) => {
          localConfirmSeq += 1;
          return {
            intentId: `7f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${localConfirmSeq}`,
            questionId: `local-q-${localConfirmSeq}`,
            label: input.operationLabel,
            autoMode: localAutoMode,
          };
        },
        claimLocalConfirmation: async () => claimResult,
        cancelLocalConfirmation: async () => {},
      },
      confirmOperation: (async (preparation: PanelHumanOperationPreparation, hooks?: { onConfirmed?: () => void }) => {
        hooks?.onConfirmed?.();
        return {
          decision: "confirm" as const,
          response: {
            kind: "dispatched" as const,
            intentId: preparation.intentId,
            outcome: nextDispatchOutcome,
          },
        };
      }) as never,
      readComponentPackage: noOperations.readComponentPackage,
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp({
      setup() {
        provide(panelContextKey, directPanelContext(instance));
        provide(directMountKey, {
          instance,
          member: (member: string) => h(PanelMember, { instance, member }),
        } as never);
        return () => h(PanelMember, { instance, member: "form" });
      },
    });
    app.use(ElementPlus);
    app.use(createI18nPlugin());
    app.mount(container);

    const textInput = (path: string) =>
      container.querySelector<HTMLInputElement>(`[data-field="${path}"] input`)!;
    const setCodeText = (path: string, text: string) => {
      const editorEl = container.querySelector<HTMLElement>(`[data-field="${path}"] .cm-editor`)!;
      const view = EditorView.findFromDOM(editorEl)!;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    };

    try {
      await vi.waitFor(() => expect(textInput("/name")?.value).toBe("Task A"));

      // 1. User edits /name manually; agent can still fill /note and refine /note without blocked_unsaved,
      //    but filling /name without overwriteUnsaved is blocked.
      textInput("/name").value = "User Name";
      textInput("/name").dispatchEvent(new Event("input"));
      await nextTick();

      expect(await instance.fillForm({ member: "form", values: { "/note": "Agent Note 1" } })).toMatchObject({
        ok: true,
        filledFields: ["/note"],
      });
      expect(await instance.fillForm({ member: "form", values: { "/note": "Agent Note 2" } })).toMatchObject({
        ok: true,
        filledFields: ["/note"],
      });
      expect(await instance.fillForm({ member: "form", values: { "/name": "Agent Override" } })).toMatchObject({
        ok: false,
        reason: "blocked_unsaved",
      });

      // 2. editGeneration catches "modify field -> revert to previous value" after save confirmation was requested.
      const pendingSave = await instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      expect(pendingSave).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!pendingSave.ok || pendingSave.kind !== "awaiting_confirmation") throw new Error("expected awaiting_confirmation");
      expect(pendingSave.confirmation.isStillValid()).toEqual({ ok: true });

      textInput("/note").value = "Temp";
      textInput("/note").dispatchEvent(new Event("input"));
      await nextTick();
      textInput("/note").value = "Agent Note 2";
      textInput("/note").dispatchEvent(new Event("input"));
      await nextTick();
      expect(pendingSave.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });

      // 3. activeInvalid (unclosed JSON) invalidates a pending discard confirmation.
      const pendingDiscard = await instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      expect(pendingDiscard).toMatchObject({ ok: true, kind: "awaiting_confirmation" });
      if (!pendingDiscard.ok || pendingDiscard.kind !== "awaiting_confirmation") throw new Error("expected awaiting_confirmation");
      expect(pendingDiscard.confirmation.isStillValid()).toEqual({ ok: true });

      setCodeText("/payload", "{ unclosed json");
      await nextTick();
      expect(pendingDiscard.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });

      // 4. Local confirmation claim rejection (e.g. after refresh/page change) gives an explicit stale explanation.
      const pendingDiscard2 = await instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      if (!pendingDiscard2.ok || pendingDiscard2.kind !== "awaiting_confirmation") throw new Error("expected awaiting_confirmation");
      claimResult = { ok: false, message: "The confirmation expired after page reload." };
      expect(await pendingDiscard2.confirmation.dispatch()).toMatchObject({
        ok: false,
        reason: "stale",
        message: "The confirmation expired after page reload.",
      });
      claimResult = { ok: true };

      // 5. Auto-mode discard skips conversation confirmation and executes immediately.
      localAutoMode = true;
      const autoDiscard = await instance.executeAction({ operation: "form.discard", agentRun: AGENT_RUN });
      expect(autoDiscard).toMatchObject({ ok: true, kind: "executed", operation: "form.discard" });
      await vi.waitFor(() => expect(instance.dirty()).toBe(false));
      expect(textInput("/name").value).toBe("Task A");
      localAutoMode = false;

      // 6. Partial refusal with savedFields reports partial with savedFields and owner error code.
      await instance.fillForm({ member: "form", values: { "/name": "Updated", "/note": "Forbidden" } });
      nextDispatchOutcome = {
        kind: "refusal",
        code: "FORBIDDEN",
        message: "Note cannot be updated",
        savedFields: { "/name": "Updated" },
      };
      const pendingPartial = await instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      if (!pendingPartial.ok || pendingPartial.kind !== "awaiting_confirmation") throw new Error("expected awaiting_confirmation");
      const partialRes = await pendingPartial.confirmation.dispatch();
      expect(partialRes).toMatchObject({
        ok: false,
        reason: "partial",
        code: "FORBIDDEN",
        savedFields: ["/name"],
      });

      // 7. Switching bound object rotates formInstanceId and rejects stale expectedFormInstanceId.
      const formIdBefore = instance.forms.snapshot("form")?.formInstanceId;
      expect(typeof formIdBefore).toBe("string");
      await instance.forms.handle("form")!.reset();
      instance.state.set("selected", { className: SCHEDULED_TASK, primaryKey: "t-2" });
      await vi.waitFor(() => expect(textInput("/name")?.value).toBe("Task B"));
      const formIdAfter = instance.forms.snapshot("form")?.formInstanceId;
      expect(formIdAfter).not.toBe(formIdBefore);

      const staleFill = await instance.fillForm({
        member: "form",
        values: { "/note": "For A not B" },
        expectedFormInstanceId: formIdBefore,
      });
      expect(staleFill).toMatchObject({ ok: false, reason: "stale" });
    } finally {
      app.unmount();
      instance.markDisposed();
    }
  });

  it("ObjectList waits for initial read readiness, rejects bare primary keys on mixed-type lists, and classifies partial batch outcomes", async () => {
    let releaseInitialRead!: () => void;
    const initialReadGate = new Promise<void>((resolve) => {
      releaseInitialRead = resolve;
    });

    const rowDeleteDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "mixed.delete",
      label: "Delete",
      effect: "write",
      batch: false,
      target: { source: "input", input: "item" },
      inputSchema: {},
      resultSchema: {},
    };
    const batchDeleteDescriptor: PanelOwnerOperationDescriptor = {
      kind: "action",
      handlerRef: "mixed.batchDelete",
      label: "Batch delete",
      effect: "write",
      batch: true,
      target: { source: "input", input: "items" },
      inputSchema: {},
      resultSchema: {},
    };

    const manifest: DirectPanelManifest = {
      state: {
        checked: {
          type: { kind: "list", items: { kind: "object-union", objectTypes: [SCHEDULED_TASK, SKILL] } },
          deepLink: false,
          personal: false,
          external: false,
        },
      },
      members: {
        list: {
          target: { projectionId: "proj-mixed-list" },
          outputs: { checked: { state: "checked" } },
        },
        batchBtn: {
          target: { projectionId: "proj-batch-btn" },
          inputs: { items: { state: "checked" } },
        },
      },
    };
    const projection: DirectProjection = {
      ...baseProjection,
      id: "proj-mixed-list",
      name: "Mixed list",
      componentId: "@ontomato/sdk:ObjectList",
      inputs: {},
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } },
          read: "list",
          params: {},
        },
      },
      outputs: {
        checked: { kind: "list", items: { kind: "object-union", objectTypes: [SCHEDULED_TASK, SKILL] } },
      },
      config: {
        selectable: true,
        rowType: { kind: "object-union", objectTypes: [SCHEDULED_TASK, SKILL] },
        rowActions: {
          items: [{ kind: "operation", operation: "remove" }],
        },
      },
      operations: {
        remove: { operation: { kind: "PlatformOperation", id: "mixed.delete" }, target: { row: true } },
      },
    };
    const batchProjection: DirectProjection = {
      ...baseProjection,
      id: "proj-batch-btn",
      name: "Batch button",
      componentId: "@ontomato/sdk:OperationButton",
      inputs: { items: { kind: "list", items: { kind: "object-union", objectTypes: [SCHEDULED_TASK, SKILL] } } },
      data: {},
      outputs: {},
      config: { operation: "batchRemove" },
      operations: {
        batchRemove: { operation: { kind: "PlatformOperation", id: "mixed.batchDelete" } },
      },
    };

    let nextOutcome: Extract<PanelHumanOperationDispatchResponse, { kind: "dispatched" }>["outcome"] = {
      kind: "success",
      data: {},
    };
    let intentSeq = 0;

    const instance = createDirectPanelInstance(manifest, {
      pageKey: "mixed-d2",
      url: () => "/mixed-d2",
      label: () => "Mixed D2",
      text: createPanelText({}, ref("en"), "en"),
      read: async (req: PanelMemberReadRequest) => {
        if (req.operations) {
          return req.memberPath[0]?.member === "batchBtn"
            ? readyOps({ batchRemove: batchDeleteDescriptor })
            : readyOps({ remove: rowDeleteDescriptor });
        }
        await initialReadGate;
        return {
          status: "ready",
          value: [
            { primaryKey: "row-1", className: SCHEDULED_TASK, label: "Task 1", fields: {} },
            { primaryKey: "row-2", className: SKILL, label: "Skill 2", fields: {} },
          ] as never,
          rowOperations: {
            [`${SCHEDULED_TASK}:row-1`]: { remove: { available: true } },
            [`${SKILL}:row-2`]: { remove: { available: true } },
          },
        };
      },
      readProjection: async (id) => (id === "proj-batch-btn" ? batchProjection : projection),
      operations: {
        ...noOperations.operations,
        prepare: async (operationId: string): Promise<PanelHumanOperationPreparation> => {
          intentSeq += 1;
          return {
            intentId: `8f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`,
            operationId,
            label: operationId,
            confirmation: { kind: "none" },
            autoMode: true,
          };
        },
        cancel: async () => {},
      },
      confirmOperation: (async (preparation: PanelHumanOperationPreparation, hooks?: { onConfirmed?: () => void }) => {
        hooks?.onConfirmed?.();
        return {
          decision: "confirm" as const,
          response: {
            kind: "dispatched" as const,
            intentId: preparation.intentId,
            outcome: nextOutcome,
          },
        };
      }) as never,
      readComponentPackage: noOperations.readComponentPackage,
      expandPageComposer: noOperations.expandPageComposer,
      navigate: noOperations.navigate,
      nested: noOperations.nested,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp({
      setup() {
        provide(panelContextKey, directPanelContext(instance));
        provide(directMountKey, {
          instance,
          member: (member: string) => h(PanelMember, { instance, member }),
        } as never);
        return () => h("div", [
          h(PanelMember, { instance, member: "list" }),
          h(PanelMember, { instance, member: "batchBtn" }),
        ]);
      },
    });
    app.use(ElementPlus);
    app.use(createI18nPlugin());
    app.mount(container);

    try {
      await vi.waitFor(() => expect(instance.operations.value.some((op) => op.id === "list.remove")).toBe(true));

      // 1. Trigger row action while initial rows read is still in flight -> waits for read completion and succeeds!
      const pendingRowAction = instance.executeAction({
        operation: "list.remove",
        rowKey: `${SCHEDULED_TASK}:row-1`,
        agentRun: AGENT_RUN,
      });
      setTimeout(() => releaseInitialRead(), 30);
      expect(await pendingRowAction).toMatchObject({ ok: true, kind: "executed", operation: "list.remove" });

      // 2. Mixed-type list rejects bare primary keys and requires `<className>:<primaryKey>`.
      const bareKeyRejected = await instance.executeAction({
        operation: "list.remove",
        rowKey: "row-1",
        agentRun: AGENT_RUN,
      });
      expect(bareKeyRejected).toMatchObject({ ok: false, reason: "input_required", operation: "list.remove" });

      // 3. Batch action checks checkedKeys consistency and classifies partial batch completion accurately.
      instance.state.set("checked", [
        { className: SCHEDULED_TASK, primaryKey: "row-1" },
        { className: SKILL, primaryKey: "row-2" },
      ]);
      await nextTick();

      const staleBatch = await instance.executeAction({
        operation: "batchBtn.batchRemove",
        expectedCheckedKeys: [`${SCHEDULED_TASK}:row-1`],
        agentRun: AGENT_RUN,
      });
      expect(staleBatch).toMatchObject({ ok: false, reason: "stale" });

      nextOutcome = {
        kind: "batch",
        items: [
          { target: { objectType: SCHEDULED_TASK, primaryKey: "row-1" }, outcome: { kind: "success", data: {} } },
          {
            target: { objectType: SKILL, primaryKey: "row-2" },
            outcome: { kind: "refusal", code: "TASK_RUNNING", message: "Busy" },
          },
        ],
      };
      const partialBatch = await instance.executeAction({
        operation: "batchBtn.batchRemove",
        expectedCheckedKeys: [`${SCHEDULED_TASK}:row-1`, `${SKILL}:row-2`],
        agentRun: AGENT_RUN,
      });
      expect(partialBatch).toMatchObject({
        ok: false,
        kind: "partially_executed",
        reason: "partial_completion",
        code: "TASK_RUNNING",
      });
    } finally {
      app.unmount();
      instance.markDisposed();
    }
  });
});
