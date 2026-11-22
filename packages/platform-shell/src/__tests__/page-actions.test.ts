import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlatformPageHeader from "../PlatformPageHeader.vue";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { providePageActions, usePageActions, type PlatformPageActions } from "../page-actions";

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

  it("keeps at most one primary button, moves danger actions last into more, and gives more a page-scoped accessible name", async () => {
    const refresh = vi.fn();
    const firstPrimary = vi.fn();
    const secondPrimary = vi.fn();
    const danger = vi.fn();
    const copyLink = vi.fn();
    const wrapper = mount(PlatformPageHeader, {
      attachTo: document.body,
      props: {
        title: "Applications",
        moreLabel: "More",
        actions: [
          { id: "refresh", label: "Refresh", icon: defineComponent({ render: () => h("svg") }), iconOnly: true, onClick: refresh },
          { id: "create", label: "Create", primary: true, onClick: firstPrimary },
          { id: "import", label: "Import", primary: true, onClick: secondPrimary },
          { id: "delete", label: "Delete", danger: true, onClick: danger },
        ],
        more: [{ id: "copy-link", label: "Copy external link", onClick: copyLink }],
      },
    });
    try {
      const visible = wrapper.findAll<HTMLButtonElement>(".page-actions > button.action");
      expect(visible.map((button) => button.text().trim())).toEqual(["Create", "Import"]);
      expect(visible[0]!.classes()).toContain("primary");
      expect(visible[1]!.classes()).toContain("secondary");
      expect(visible[1]!.classes()).not.toContain("primary");

      const moreTrigger = wrapper.get<HTMLButtonElement>(".page-more > button");
      expect(moreTrigger.attributes("aria-label")).toBe("Applications More");
      await moreTrigger.trigger("click");

      const menuItems = wrapper.findAll<HTMLButtonElement>(".page-more-menu [role='menuitem']");
      expect(menuItems.map((item) => item.text().trim())).toEqual(["Copy external link", "Delete"]);
      expect(menuItems[1]!.classes()).toContain("danger");
      expect(wrapper.find(".page-more-menu [role='separator']").exists()).toBe(true);

      // Escape closes the menu and restores focus to the trigger.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await nextTick();
      expect(wrapper.find(".page-more-menu").exists()).toBe(false);
      expect(document.activeElement).toBe(moreTrigger.element);

      // Re-open and click danger item.
      await moreTrigger.trigger("click");
      await wrapper.findAll<HTMLButtonElement>(".page-more-menu [role='menuitem']")[1]!.trigger("click");
      expect(danger).toHaveBeenCalledOnce();
      expect(wrapper.find(".page-more-menu").exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it("shows the more menu for danger actions even when props.more is empty and closes on outside pointerdown", async () => {
    const wrapper = mount(PlatformPageHeader, {
      attachTo: document.body,
      props: {
        title: "Triggers",
        actions: [{ id: "delete", label: "Delete", danger: true, onClick: vi.fn() }],
      },
    });
    try {
      const moreTrigger = wrapper.get<HTMLButtonElement>(".page-more > button");
      expect(moreTrigger.attributes("aria-label")).toBe("Triggers More");
      await moreTrigger.trigger("click");
      expect(wrapper.find(".page-more-menu").exists()).toBe(true);
      expect(wrapper.find(".page-more-menu [role='separator']").exists()).toBe(false);
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await nextTick();
      expect(wrapper.find(".page-more-menu").exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
