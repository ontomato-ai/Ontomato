import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { FormField } from "@ontomato/contracts/form-fields";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { projectionKey, type ProjectionSlot } from "../../../../../packages/apps-sdk/src/panel/context";
import { registerPlatformObject, type PlatformObjectForm } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { registeredHandlers } from "../../../../../packages/apps-sdk/src/panel/handlers";
import ObjectForm from "../../../../../packages/apps-sdk/src/base/ObjectForm.vue";

/*
 * The form a panel shows (design 10.3, third and sixth checks): a draft an agent wrote opens in it with its values, its
 * changed fields marked and nothing written; the reader's save is one operation at the revision the form was read at, so
 * a change somebody else made meanwhile is refused instead of replaced.
 *
 * The mistakes these catch: a draft that reaches the SDK but never the form (so the reader sees the object's current
 * values and no marker), and a save that re-reads the object first, which makes the owner's own revision check useless.
 */

/** Each test registers its own object type: this version registers a type once, and these tests are one version. */
let typeCount = 0;

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
    state: { selectedTask: { kind: "object", objectType, deepLink: true } },
    slots: { form: { projectionId: "projection-schedules-form", inputs: { task: { state: "selectedTask" } } } },
    operations: [],
  });
}

/** Registers the form projection as `<Projection>` does, and mounts the form under its context and slot. */
function mounted(save: (values: Record<string, string>, revision: number) => Promise<unknown>) {
  typeCount += 1;
  const objectType = `test:Task${typeCount}`;
  const panel = panelFor(objectType);
  const instance = createPanelInstance(panel, {
    pageKey: "panels-trial-a-tasks",
    url: () => "/applications/app-panels-trial-a/tasks",
    label: () => "Scheduled tasks (trial)",
    initial: { selectedTask: { className: objectType, primaryKey: "task-1" } },
    readProjection: async () => ({
      id: "projection-schedules-form",
      domainId: "domain-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
      editable: false,
      name: "Task form",
      description: "",
      visibility: "domain",
      componentId: "ObjectForm",
      binding: { kind: "PlatformObjectType", id: objectType },
      inputs: { task: { kind: "object", objectType } },
      display: {},
    }),
  });
  const form = vi.fn(async (): Promise<PlatformObjectForm> => ({
    fields: fields("autotest"),
    values: { operation: "autotest", caseSetId: "cases-1" },
    revision: 7,
  }));
  const changed = vi.fn(async (): Promise<PlatformObjectForm> => ({
    fields: fields("inspection"),
    values: { operation: "inspection", instruction: "" },
    revision: 7,
  }));
  registerPlatformObject({
    objectType,
    list: async () => [],
    read: async (primaryKey) => ({ primaryKey, label: "Nightly", fields: {} }),
    form,
    changed,
    save: async (primaryKey, values, revision) => {
      await save(values, revision);
      return { primaryKey, label: "Nightly", fields: {} };
    },
  });

  const unregister = instance.register({
    slot: "form",
    projectionId: "projection-schedules-form",
    ports: {
      binding: `PlatformObjectType:${objectType}`,
      inputs: { task: { kind: "object", objectType } },
      operations: [{ name: "save", label: "Save", kind: "form.save", inputSchema: {}, handlerRef: `${objectType}.save` }],
    },
    invoke: (handlerRef, call) => instance.runHandler(handlerRef, call),
  });

  const slot: ProjectionSlot = {
    slot: "form",
    projection: {
      id: "projection-schedules-form",
      domainId: "domain-1",
      ownerId: "owner-1",
      revision: 1,
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
      editable: false,
      name: "Task form",
      description: "",
      visibility: "domain",
      componentId: "ObjectForm",
      binding: { kind: "PlatformObjectType", id: objectType },
      inputs: { task: { kind: "object", objectType } },
      display: {},
    },
    inputs: {},
  };
  const app = createApp(
    defineComponent({
      setup: () => {
        provide(panelContextKey, {
          panel: { id: "panel-schedules-trial", domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, name: "Scheduled tasks (trial)", description: "", visibility: "domain", content: { html: "", module: "" }, manifest: panel },
          manifest: panel,
          instance,
          projection: (id: string) => instance.projection(id),
          invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
          projectionsChanged: () => () => {},
          draft: ref(null),
          holdUnsaved: () => () => {},
        });
        provide(projectionKey, slot);
        return () => h(ObjectForm);
      },
    }),
  );
  const element = document.createElement("div");
  app.mount(element);
  return { app, element, form, changed, unregister, save, instance, objectType };
}

/** What each field holds, by its key: a text's own value, or what a choice shows. */
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
    const { app, element, form } = mounted(async () => ({}));
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));
    expect(form).toHaveBeenCalledWith("task-1");
    expect(shown(element)).toMatchObject({ operation: expect.stringContaining("Run automated tests") });
    app.unmount();
  });

  it("takes a draft: its values in the form, its changed fields marked, and nothing written", async () => {
    const written: unknown[] = [];
    const mountedForm = mounted(async (...args) => void written.push(args));
    const { app, element } = mountedForm;
    const M = mountedForm.instance;
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));

    // The draft an agent wrote for this panel: it switches the operation and gives an instruction.
    M.forms.apply({
      slot: "form",
      operation: `${mountedForm.objectType}.save`,
      target: { id: "task-1" },
      form: { operation: "inspection", instruction: "look at tonight's failures" },
      changed: new Set(["operation", "instruction"]),
    });
    await vi.waitFor(() => expect(shown(element).instruction).toBe("look at tonight's failures"));
    // The form shows the draft's values, and the fields it changed are marked.
    // The field set is the owner's answer for the draft's operation: the instruction the draft switched to.
    expect(Object.keys(shown(element))).toEqual(["operation", "instruction"]);
    expect(element.textContent).toContain("Changed:");
    expect(element.textContent).toContain("operation");
    expect(element.textContent).toContain("instruction");
    // Nothing was written: the draft is the reader's to save.
    expect(written).toEqual([]);
    expect(registeredHandlers()).toContain(`${mountedForm.objectType}.save`);

    // The reader saves: one write, at the revision the form was read at.
    await M.invoke("form.save");
    expect(written).toHaveLength(1);
    mountedForm.unregister();
    app.unmount();
  });

  it("saves at the revision the form was opened at, and shows the owner's refusal instead of overwriting", async () => {
    const save = vi.fn(async (_values: Record<string, string>, _revision: number) => undefined);
    const first = mounted(save);
    const { app, element } = first;
    const M = first.instance;
    await vi.waitFor(() => expect(element.textContent).toContain("Run automated tests"));
    // The form was read at revision 7; the save names that one, whatever the object's revision is by then.
    await M.invoke("form.save");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ operation: "autotest" }), 7);

    // An owner that refuses the write (somebody else changed the task) has its answer shown, and nothing is retried.
    const refused = vi.fn(async () => {
      throw new Error("The task changed; reload it before saving");
    });
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
