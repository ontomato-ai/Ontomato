import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlatformPageHeader from "../PlatformPageHeader.vue";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { pageActionRow, providePageActions, usePageActions, type PlatformPageActions } from "../page-actions";

describe("page header actions", () => {
  it("exposes pending saves and actions without allowing another submission", async () => {
    const onSave = vi.fn();
    const onClick = vi.fn();
    const draft = { dirty: true, saving: true, save: onSave, discard: vi.fn() };
    const action = { id: "refresh", label: "Refresh", loading: true, onClick };
    const wrapper = mount(PlatformPageHeader, { props: {
      draft, actions: [action], onSave,
      labels: { save: "Save", discard: "Discard", unsavedChanges: "Unsaved changes" },
    } });
    try {
      const buttons = wrapper.findAll<HTMLButtonElement>('button[aria-busy="true"]');
      expect(buttons.map(button => button.text())).toEqual(["Refresh", "Save"]);
      for (const button of buttons) {
        expect(button.element.disabled).toBe(true);
        button.element.click();
      }
      expect(onClick).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      await wrapper.setProps({ draft: { ...draft, saving: false }, actions: [{ ...action, loading: false }] });
      await wrapper.get("button.primary").trigger("click");
      expect(onSave).toHaveBeenCalledOnce();
    } finally {
      wrapper.unmount();
    }
  });
  it("reach the frame that draws the header, and leave it when the page unmounts", async () => {
    const save = () => {};
    const page = defineComponent({
      setup() {
        usePageActions(() => ({ draft: { dirty: true, saving: false, save, discard: () => {} } }));
        return () => h("div");
      },
    });
    const shown = ref(true);
    let read: Readonly<Ref<PlatformPageActions | null>> | null = null;
    const app = createApp(
      defineComponent({
        setup() {
          read = providePageActions();
          return () => (shown.value ? h(page) : null);
        },
      })
    );
    app.mount(document.createElement("div"));
    await nextTick();

    expect(read!.value?.draft?.dirty).toBe(true);
    expect(read!.value?.draft?.save).toBe(save);

    shown.value = false;
    await nextTick();
    expect(read!.value).toBeNull();
    app.unmount();
  });
});

describe("a page's operations in its header", () => {
  it("shows one button per operation it offers, and a click runs that operation here", async () => {
    const invoked: string[] = [];
    const operations = [
      { id: "runTask.runNow", label: "Run now", kind: "action" as const, inputSchema: {}, target: { source: "state" as const, state: "selectedTask" }, slot: "runTask", handlerRef: "schedules.runNow", invoke: async () => invoked.push("runNow") },
      { id: "taskForm.update", label: "Save", kind: "form.save" as const, inputSchema: {}, target: { source: "state" as const, state: "selectedTask" }, slot: "taskForm", handlerRef: "schedules.update", invoke: async () => invoked.push("save") },
    ];
    const row = pageActionRow({ operations });
    // The form save is the header's own Save, which its draft draws; the rest are the page's buttons.
    expect(row.map((action) => action.id)).toEqual(["runTask.runNow"]);
    row[0]!.onClick();
    await Promise.resolve();
    expect(invoked).toEqual(["runNow"]);
  });

  it("keeps a page's own buttons beside its operations", () => {
    const row = pageActionRow({
      actions: [{ id: "refresh", label: "Refresh", onClick: () => {} }],
      operations: [
        { id: "runTask.runNow", label: "Run now", kind: "action", inputSchema: {}, target: { source: "state", state: "task" }, slot: "runTask", handlerRef: "schedules.runNow", invoke: async () => null },
      ],
    });
    expect(row.map((action) => action.id)).toEqual(["refresh", "runTask.runNow"]);
  });
});
