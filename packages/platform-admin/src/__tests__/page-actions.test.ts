import { describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { providePageActions, usePageActions, usePageActionsOf } from "../context";

describe("page header actions", () => {
  it("reach the layout through the slot the app provides, and leave it when the page unmounts", async () => {
    const save = () => {};
    const page = defineComponent({
      setup() {
        usePageActions(() => ({ dirty: true, saving: false, save, discard: () => {} }));
        return () => h("div");
      },
    });
    let read: ReturnType<typeof usePageActionsOf> | null = null;
    const app = createApp(
      defineComponent({
        setup() {
          read = usePageActionsOf();
          return () => h(page);
        },
      })
    );
    const slot = providePageActions(app);
    app.mount(document.createElement("div"));
    await nextTick();

    expect(read).toBe(slot);
    expect(slot.value?.dirty).toBe(true);
    expect(slot.value?.save).toBe(save);

    app.unmount();
    expect(slot.value).toBeNull();
  });
});
