import { describe, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, provide } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { FormField } from "@ontomato/contracts/form-fields";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { projectionKey, type ProjectionSlot } from "../../../../../packages/apps-sdk/src/panel/context";
import { formFieldPointer } from "@ontomato/contracts/form-fields";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormSaveInput } from "@ontomato/contracts/panel-projection";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { portsOf } from "../../../../../packages/apps-sdk/src/panel/ports-of";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import ObjectForm from "../../../../../packages/apps-sdk/src/base/ObjectForm.vue";

import { noOperations, projections, SCHEDULED_TASK } from "./panel-frame";
/*
 * The form a panel shows (design 10.3, third and sixth checks): a draft an agent wrote opens in it with its values, its
 * changed fields marked and nothing written; the reader's save is one operation at the revision the form was read at, so
 * a change somebody else made meanwhile is refused instead of replaced.
 *
 * The mistakes these catch: a draft that reaches the SDK but never the form (so the reader sees the object's current
 * values and no marker), and a save that re-reads the object first, which makes the owner's own revision check useless.
 */

/** The form the owner answers: an operation that decides which other fields exist, as the trial's application does. */
const fields = (operation: string): readonly FormField[] => [
  {
    key: "operation", label: "Operation", required: true, defaultValue: "autotest", help: null, type: "select",
    refreshOnChange: true,
    options: [
      { value: "autotest", label: "Run automated tests", description: null, disabled: false, disabledReason: null },
      { value: "inspection", label: "Inspection", description: null, disabled: false, disabledReason: null },
    ],
  },
  ...(operation === "inspection"
    ? [{ key: "instruction", label: "Instruction", required: true, defaultValue: null, help: null, type: "text" as const,
        multiline: true, placeholder: null, maxLength: 4000 }]
    : [{ key: "caseSetId", label: "Case set", required: true, defaultValue: "cases-1", help: null, type: "select" as const,
        refreshOnChange: false,
        options: [{ value: "cases-1", label: "Cases (12)", description: null, disabled: false, disabledReason: null }] }]),
];

function panelFor(objectType: string) {
  return definePanel({
    state: { selectedTask: { type: { kind: "object", objectType }, deepLink: true } },
    members: { form: { target: { projectionId: "projection-schedules-form" }, inputs: { task: { state: "selectedTask" } } } },
    commands: {},
  });
}

/** Mounts the form with the member and coordinator ports a frame supplies. */
function mounted(save: (input: PanelFormSaveInput) => Promise<PanelOperationOutcome | void>) {
  const panel = panelFor(SCHEDULED_TASK);
  const task = { className: SCHEDULED_TASK, primaryKey: "task-1" };
  const projection = projections["projection-schedules-form"]!;
  let input: PanelFormSaveInput;
  const instance = createPanelInstance(panel, {
    text: (key) => key,
    operations: {
      ...noOperations.operations,
      async prepare(operationId, invocation) {
        if (!("call" in invocation)) throw new Error("A form save prepares one call");
        input = panelFormSaveInputSchema.parse(invocation.call.input);
        return {
          intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId,
          label: "Save", confirmation: { kind: "none" },
        };
      },
    },
    async confirmOperation({ intentId }) {
      const outcome = await save(input) ?? { kind: "success" as const, data: {} };
      return { decision: "confirm", response: { kind: "dispatched", intentId, outcome } };
    },
    pageKey: "panels-trial-a-tasks",
    url: () => "/applications/app-panels-trial-a/tasks",
    label: () => "Scheduled tasks (trial)",
    initial: { selectedTask: task },
    recordDraftCreated: async () => {},
    readProjection: async () => projection,
  });
  // The owner, as the scheduled tasks' typed adapter answers: the operation decides which other fields exist.
  const typed = (operation: string, values: Record<string, string>): PanelFormDescription => ({
    fields: fields(operation).map((field) => ({
      path: formFieldPointer("/", field.key), label: field.label, required: field.required, readOnly: false, valueSchema: {},
      ...(field.type === "select"
        ? { control: { kind: "select" as const, options: field.options }, refreshOnChange: field.refreshOnChange }
        : { control: { kind: "text" as const, multiline: field.multiline } }),
    })),
    values,
    revision: 7,
    errors: [],
    save: { method: "PUT", path: "/platform/scheduled-tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
  });
  const form = vi.fn(async (_primaryKey: string) => typed("autotest", { operation: "autotest", caseSetId: "cases-1" }));
  const changed = vi.fn(async (values: Record<string, string>) =>
    typed(values.operation!, values.operation === "inspection" ? { operation: "inspection", instruction: values.instruction ?? "" } : values));
  // The owner's save of the chosen task, as it admits it.
  const operations = computed(() => ({ status: "ready" as const, value: { save: {
    kind: "form.save" as const, handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write" as const,
    target: { source: "input" as const, input: "task" }, inputSchema: {}, resultSchema: {}, batch: false,
  } } }));
  const unregister = instance.register({
    slot: "form", projectionId: projection.id, ports: portsOf(projection), operations: operations.value.value, takesDrafts: true,
  });

  const inputs = computed(() => ({ task }));
  const slot: ProjectionSlot = { slot: "form", projection, inputs: inputs.value };
  const member: PanelMemberContext = {
    key: "form", projection, inputs, operations,
    data: {
      use() { throw new Error("The form reads its description on demand"); },
      async read(_name, { values, changedField }, { task } = {}) {
        const primaryKey = (task as { primaryKey: string }).primaryKey;
        if (values === undefined) return { status: "ready", value: await form(primaryKey) };
        const draft = values as Record<string, string>;
        const answer = await changed(draft);
        // An incoming draft is checked whole, with the owner's fields for the changed operation.
        return { status: "ready", value: changedField === null ? { ...answer, values: { ...answer.values, ...draft } } : answer };
      },
    },
  };
  const app = createApp(
    defineComponent({
      setup: () => {
        provide(panelContextKey, {
          panel: { content: { html: "", module: "" }, manifest: panel },
          manifest: panel,
          instance,
          projection: (id: string) => instance.projection(id),
          invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
          projectionsChanged: () => () => {},
          draft: instance.draft,
          holdUnsaved: () => () => {},
          t: (key: string) => key,
          resources: async () => {},
          expandPageComposer: async () => {},
          notify: () => { throw new Error("This test tells the reader nothing"); }, readPanelData: async () => { throw new Error("This test reads no member data through the platform"); }, navigate: async () => { throw new Error("This test opens no address"); }, currentEntry: computed(() => null), entryMenu: computed(() => null),
        });
        provide(projectionKey, slot);
        provide(panelMemberKey, () => member);
        return () => h(ObjectForm);
      },
    }),
  );
  const element = document.createElement("div");
  // The frame installs Element Plus (apps-sdk panel/mount), so the form draws the same buttons it does there.
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.mount(element);
  return { app, element, form, unregister, instance };
}

/** What each field holds, by its path: a text's own value, or what a choice shows. */
function shown(element: Element) {
  const result: Record<string, string> = {};
  for (const item of element.querySelectorAll(".el-form-item")) {
    const key = item.getAttribute("data-field") ?? "";
    const text = item.querySelector("textarea") as HTMLTextAreaElement | null;
    result[key] = text ? text.value.trim() : (item.textContent ?? "").trim();
  }
  return result;
}

describe("the form a panel shows", () => {
  it("shows what the owner holds, at the revision it was read at", async () => {
    const { app, element, form } = mounted(async () => {});
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));
    expect(form).toHaveBeenCalledWith("task-1");
    expect(shown(element)).toMatchObject({ "/operation": expect.stringContaining("Run automated tests") });
    app.unmount();
  });

  it("takes a draft: its values in the form, its changed fields marked, and nothing written", async () => {
    const written: unknown[] = [];
    const mountedForm = mounted(async (...args) => void written.push(args));
    const { app, element } = mountedForm;
    const M = mountedForm.instance;
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));

    // The draft an agent wrote for this panel: it switches the operation and gives an instruction.
    M.forms.hold(
      {
        pageKey: "panels-trial-a-tasks",
        operation: `${SCHEDULED_TASK}.save`,
        target: { objectType: SCHEDULED_TASK, id: "task-1" },
        form: { operation: "inspection", instruction: "look at tonight's failures" },
      },
      { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/a.page-draft.json" },
      () => {},
    );
    await vi.waitFor(() => expect(shown(element)["/instruction"]).toBe("look at tonight's failures"));
    // The form shows the draft's values, and the fields it changed are marked.
    // The field set is the owner's answer for the draft's operation: the instruction the draft switched to.
    expect(Object.keys(shown(element))).toEqual(["/operation", "/instruction"]);
    expect([...element.querySelectorAll(".sdk-owner-form-field-changed")].map((item) => item.getAttribute("data-field")))
      .toEqual(["/operation", "/instruction"]);
    expect(element.querySelector(".sdk-owner-form-changed")?.textContent?.trim()).toBe("Changed: Operation, Instruction");
    // Nothing was written: the draft is the reader's to save.
    expect(written).toEqual([]);
    expect(M.operations.value).toEqual([expect.objectContaining({ id: "form.save", handlerRef: `${SCHEDULED_TASK}.save` })]);

    // The reader saves with the form's own button: one write, at the revision the form was read at. The panel frame is
    // sandboxed without allow-forms, where the browser drops a native form submission, so the button is not a submit.
    const saveButton = [...element.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save")!;
    expect(saveButton.type).toBe("button");
    saveButton.click();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toEqual([{
      values: { operation: "inspection", instruction: "look at tonight's failures" },
      revision: 7,
      submittedFields: ["/operation", "/instruction"],
    }]);
    mountedForm.unregister();
    app.unmount();
  });

  it("saves at the revision the form was opened at, and shows the owner's refusal instead of overwriting", async () => {
    const save = vi.fn(async (_input: PanelFormSaveInput) => undefined);
    const first = mounted(save);
    const { app, element } = first;
    const M = first.instance;
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));
    // The form was read at revision 7; the save names that one, whatever the object's revision is by then.
    await M.invoke("form.save");
    expect(save).toHaveBeenCalledWith({ values: { operation: "autotest", caseSetId: "cases-1" }, revision: 7, submittedFields: [] });

    // An owner that refuses the write (somebody else changed the task) has its answer shown, and nothing is retried.
    const refused = vi.fn(async (): Promise<PanelOperationOutcome> => ({
      kind: "refusal", code: "REVISION_CONFLICT", message: "The task changed; reload it before saving",
    }));
    first.unregister();
    const second = mounted(refused);
    await vi.waitFor(() => expect(second.element.textContent).toContain("Run automated tests"));
    await expect(second.instance.invoke("form.save")).rejects.toThrow(/changed/);
    await vi.waitFor(() => expect(second.element.textContent).toContain("The task changed"));
    expect(refused).toHaveBeenCalledTimes(1);

    app.unmount();
    second.app.unmount();
    second.unregister();
  });
});
