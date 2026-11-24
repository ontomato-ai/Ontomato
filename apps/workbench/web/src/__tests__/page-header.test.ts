import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import ConditionalPageHeader from "./fixtures/ConditionalPageHeader.vue";

it.each(["actions", "title"])("shows and hides a conditional %s slot", async (slot) => {
  const ready = ref(false);
  const container = document.createElement("div");
  const app = createApp({
    setup: () => () => h(ConditionalPageHeader, {
      showActions: slot === "actions" && ready.value,
      showTitle: slot === "title" && ready.value,
    }),
  });
  app.mount(container);
  try {
    expect(container.querySelector("[data-testid=detail]")).toBeNull();
    ready.value = true;
    await nextTick();
    expect(container.querySelector("[data-testid=detail]")).not.toBeNull();
    ready.value = false;
    await nextTick();
    expect(container.querySelector("[data-testid=detail]")).toBeNull();
  } finally {
    app.unmount();
  }
});
