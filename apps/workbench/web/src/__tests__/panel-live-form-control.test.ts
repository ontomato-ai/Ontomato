import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * End-to-end component checks for live agent remote control (`fillForm` and `executeAction`) against mounted
 * `ObjectForm` instances:
 * - `fillForm` fills active fields live, refuses overwriting unsaved edits unless `overwriteUnsaved: true`, and
 *   reports `form_ambiguous` when multiple forms are open without an explicit `member`.
 * - `executeAction` on a form's save prepares an intent with `agentRun`, defers to `awaiting_confirmation` when
 *   `autoMode: false`, validates staleness if the form is edited, discarded, or retargeted before confirmation (calling
 *   `cancel` without dispatching), and dispatches & settles the form cleanly once confirmed while still valid.
 */

const AGENT_RUN = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
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

const taskFormProjection = (id: string, inputName = "task"): DirectProjection => ({
  ...baseRecord,
  id,
  name: id,
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    [inputName]: { kind: "object", objectType: SCHEDULED_TASK },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: inputName } },
      read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    },
  },
  operations: {
    save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: inputName } },
  },
});

const saveDescriptor = {
  kind: "form.save" as const,
  handlerRef: `${SCHEDULED_TASK}.save`,
  label: "Save task",
  effect: "write" as const,
  target: { source: "input" as const, input: "task" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });

function mountLiveForm(options: {
  autoMode: boolean;
  twoForms?: boolean;
} = { autoMode: false }) {
  const projections: Record<string, DirectProjection> = {
    "task-form": taskFormProjection("task-form"),
    ...(options.twoForms ? { "second-form": taskFormProjection("second-form") } : {}),
  };
  const manifest: DirectPanelManifest = {
    state: {
      selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false },
    },
    members: {
      form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
      ...(options.twoForms
        ? { secondForm: { target: { projectionId: "second-form" }, inputs: { task: { state: "selectedTask" } } } }
        : {}),
    },
  };

  let intentSeq = 0;
  const prepared: { intentId: string; operationId: string; invocation: unknown; agentRun?: unknown }[] = [];
  const dispatched: { intentId: string; skipDialog?: boolean }[] = [];
  const cancelled: { intentId: string; reason: { code: string; message?: string } }[] = [];
  const savedEvents: unknown[] = [];

  const prepare = vi.fn(async (
    operationId: string,
    invocation: unknown,
    _memberPath?: unknown,
    agentRun?: unknown,
  ): Promise<PanelHumanOperationPreparation> => {
    intentSeq += 1;
    const intentId = `5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d0${intentSeq}`;
    prepared.push({ intentId, operationId, invocation, agentRun });
    return {
      intentId,
      operationId,
      label: "Save task",
      confirmation: { kind: "confirm", title: "Save task" },
      autoMode: options.autoMode,
      ...(options.autoMode ? {} : { questionId: `question-${intentSeq}` }),
    };
  });

  const cancel = vi.fn(async (intentId: string, reason: { code: string; message?: string }) => {
    cancelled.push({ intentId, reason });
  });

  const confirmOperation = vi.fn(async (
    preparation: PanelHumanOperationPreparation,
    hooks?: { onConfirmed?: () => void; skipDialog?: boolean },
  ) => {
    hooks?.onConfirmed?.();
    dispatched.push({ intentId: preparation.intentId, skipDialog: hooks?.skipDialog });
    return {
      decision: "confirm" as const,
      response: {
        kind: "dispatched" as const,
        intentId: preparation.intentId,
        outcome: {
          kind: "success" as const,
          data: {},
          affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK] },
        },
      },
    };
  });

  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "tasks",
    url: () => "/tasks",
    label: () => "Tasks",
    initial: { selectedTask: task("t-1") },
    text: createPanelText({}, ref("en"), "en"),
    operations: { ...noOperations.operations, prepare, cancel },
    confirmOperation,
    expandPageComposer: noOperations.expandPageComposer,
    navigate: noOperations.navigate,
    nested: noOperations.nested,
    readProjection: async (id) => projections[id]!,
    read: async (request: PanelMemberReadRequest) => {
      if (request.operations) return ready({ save: saveDescriptor });
      const current = (request.inputs.task as { primaryKey: string }).primaryKey;
      const values = (request.inputs.values as Record<string, unknown> | undefined) ?? {
        name: `Task ${current}`,
        note: "initial",
      };
      return ready({
        fields: [
          { path: "/name", label: "Name", control: { kind: "text" }, valueSchema: {}, required: true, readOnly: false },
          { path: "/note", label: "Note", control: { kind: "text" }, valueSchema: {}, required: false, readOnly: false },
        ],
        values,
        errors: [],
        revision: 4,
        save: { method: "PUT", path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
      });
    },
  });

  const element = document.createElement("div");
  document.body.append(element);
  const memberKeys = Object.keys(manifest.members);
  const app = createApp({
    render: () => h(
      "div",
      memberKeys.map((member) => h(PanelMember, {
        instance,
        member,
        onSaved: (payload: unknown) => savedEvents.push(payload),
      })),
    ),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  const input = (path: string) => element.querySelector<HTMLInputElement>(`[data-field="${path}"] input`)!;
  return {
    instance,
    element,
    input,
    prepared,
    dispatched,
    cancelled,
    savedEvents,
    unmount: () => app.unmount(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("live form fillForm and executeAction confirmation lifecycle", () => {
  it("prepares form save, defers to confirmation, detects stale edits or discard, and dispatches cleanly once confirmed", async () => {
    const harness = mountLiveForm({ autoMode: false });
    try {
      await vi.waitFor(() => expect(harness.input("/name")?.value).toBe("Task t-1"));

      // 1. Live fill omits member when a single form is mounted; only changed fields are marked and submitted.
      const filled = await harness.instance.fillForm({ values: { "/note": "agent updated" } });
      expect(filled).toMatchObject({ ok: true, member: "form", filledFields: ["/note"] });
      expect(harness.input("/note").value).toBe("agent updated");
      expect(harness.instance.dirty()).toBe(true);

      // Dirty form blocks another fillForm unless overwriteUnsaved is explicitly true.
      expect(await harness.instance.fillForm({ values: { "/note": "second attempt" } })).toMatchObject({
        ok: false,
        reason: "blocked_unsaved",
        member: "form",
      });
      expect(await harness.instance.fillForm({ values: { "/note": "confirmed note" }, overwriteUnsaved: true })).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/note"],
      });

      // 2. executeAction prepares intent with agentRun and defers confirmation without dispatching yet.
      const pendingEdit = await harness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      expect(pendingEdit).toMatchObject({
        ok: true,
        kind: "awaiting_confirmation",
        operation: "form.save",
        questionId: "question-1",
      });
      expect(harness.prepared).toHaveLength(1);
      expect(harness.prepared[0]).toMatchObject({
        operationId: "form.save",
        agentRun: AGENT_RUN,
        invocation: {
          call: {
            target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" },
            input: {
              revision: 4,
              values: { name: "Task t-1", note: "confirmed note" },
              submittedFields: ["/note"],
            },
          },
        },
      });
      expect(harness.dispatched).toHaveLength(0);
      if (!pendingEdit.ok || pendingEdit.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");
      expect(pendingEdit.confirmation.isStillValid()).toEqual({ ok: true });

      // 3. User edits the form before confirming -> confirmation self-check detects staleness and cancels without dispatch.
      harness.input("/note").value = "user typed after prepare";
      harness.input("/note").dispatchEvent(new Event("input"));
      await nextTick();
      expect(pendingEdit.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });

      const staleResult = await pendingEdit.confirmation.dispatch();
      expect(staleResult).toMatchObject({ ok: false, intentId: pendingEdit.intentId, reason: "stale" });
      expect(harness.dispatched).toHaveLength(0);
      expect(harness.cancelled).toEqual([
        expect.objectContaining({
          intentId: pendingEdit.intentId,
          reason: expect.objectContaining({ code: "FORM_CONFIRMATION_STALE" }),
        }),
      ]);

      // 4. Prepare again, then user discards -> confirmation also becomes stale and cancels without dispatch.
      const pendingDiscard = await harness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      if (!pendingDiscard.ok || pendingDiscard.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");
      harness.instance.forms.discard("form");
      await nextTick();
      expect(pendingDiscard.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });
      expect(await pendingDiscard.confirmation.dispatch()).toMatchObject({
        ok: false,
        intentId: pendingDiscard.intentId,
        reason: "stale",
      });
      expect(harness.dispatched).toHaveLength(0);
      expect(harness.cancelled).toHaveLength(2);

      // 5. Re-fill and prepare again; confirm while untouched -> dispatches with skipDialog and settles the form cleanly.
      expect(await harness.instance.fillForm({ values: { "/note": "final note" } })).toMatchObject({
        ok: true,
        member: "form",
        filledFields: ["/note"],
      });
      const pendingFinal = await harness.instance.executeAction({ operation: "form.save", agentRun: AGENT_RUN });
      if (!pendingFinal.ok || pendingFinal.kind !== "awaiting_confirmation") throw new Error("Expected confirmation");
      expect(pendingFinal.confirmation.isStillValid()).toEqual({ ok: true });

      const finalResult = await pendingFinal.confirmation.dispatch();
      expect(finalResult).toMatchObject({
        ok: true,
        intentId: pendingFinal.intentId,
        outcome: { kind: "success" },
      });
      expect(harness.dispatched).toEqual([{ intentId: pendingFinal.intentId, skipDialog: true }]);
      expect(harness.savedEvents).toEqual([{ className: SCHEDULED_TASK, primaryKey: "t-1" }]);
      expect(harness.instance.dirty()).toBe(false);
      expect(harness.element.querySelector(".sdk-owner-form-changed")).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("reports form_ambiguous when multiple forms are mounted and fillForm omits member", async () => {
    const harness = mountLiveForm({ autoMode: true, twoForms: true });
    try {
      await vi.waitFor(() => expect(harness.element.querySelectorAll('[data-field="/name"] input')).toHaveLength(2));

      const ambiguous = await harness.instance.fillForm({ values: { "/note": "ambiguous" } });
      expect(ambiguous).toMatchObject({ ok: false, reason: "form_ambiguous" });

      const targeted = await harness.instance.fillForm({ member: "secondForm", values: { "/note": "only second" } });
      expect(targeted).toMatchObject({ ok: true, member: "secondForm", filledFields: ["/note"] });
      expect(harness.instance.forms.dirty("form")).toBe(false);
      expect(harness.instance.forms.dirty("secondForm")).toBe(true);
    } finally {
      harness.unmount();
    }
  });
});
