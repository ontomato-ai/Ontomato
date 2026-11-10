import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import MetricViewData from "../app-components/MetricViewData.vue";
import { metricViewsKey } from "../clients/metric-views";

const apps: App[] = [];
afterEach(() => apps.splice(0).forEach((app) => app.unmount()));

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

// SDK apps draw from the slot and reach the same state from their script through a template ref, such as to read the
// MetricView again after an Action whose form is outside the slot. Without it the ref holds nothing and the call fails.
describe("MetricViewData through a template ref", () => {
  it("reads again on reload() and holds the data the slot draws", async () => {
    let reads = 0;
    const view = ref<InstanceType<typeof MetricViewData> | null>(null);
    let drawn: unknown;
    const app = createApp(defineComponent({
      setup: () => () => h(MetricViewData, { ref: view, metricViewId: "orders" }, {
        default: ({ data }: { data: unknown }) => {
          drawn = data;
          return h("div");
        },
      }),
    }));
    app.provide(metricViewsKey, { read: async () => [{ reads: ++reads }] });
    app.mount(document.createElement("div"));
    apps.push(app);
    await settle();
    expect(view.value!.data).toEqual([{ reads: 1 }]);
    expect(drawn).toBe(view.value!.data);

    await view.value!.reload();
    await nextTick();
    expect(reads).toBe(2);
    expect(view.value!.data).toEqual([{ reads: 2 }]);
    expect(drawn).toBe(view.value!.data);
  });
});
