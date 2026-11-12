import { describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { providePageActions, usePageActions, type PlatformPageActions } from "../page-actions";

describe("page header actions", () => {
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
