import { expect, it, vi } from "vitest";
import { createApp } from "vue";
import { runPanelModule, useTemplateCompiler } from "../panel-module";

it("renders a runtime template without warnings from the component proxy", async ({ onTestFinished }) => {
  const warn = vi.spyOn(console, "warn");
  onTestFinished(() => { warn.mockRestore(); });
  await useTemplateCompiler();
  const app = createApp({
    setup: () => ({ label: "Panel content" }),
    template: "<p>{{ label }}</p>",
  });
  const container = document.createElement("div");
  const instance = app.mount(container);
  onTestFinished(() => { app.unmount(); });

  expect(instance.$).toHaveProperty("render._rc", true);
  expect(container.textContent).toBe("Panel content");
  expect(warn.mock.calls.map(([message]) => message)).not.toContainEqual(
    expect.stringContaining("Property undefined was accessed during render"),
  );
});

it("runs a panel's literal dynamic import against the same namespace as its static import", async () => {
  const mountPanel = () => undefined;
  const exported = await runPanelModule(`
    import { mountPanel } from "@ontomato/sdk/panel";
    const sdk = await import("@ontomato/sdk/panel");
    if (mountPanel !== sdk.mountPanel) throw new Error("The two imports supplied different bindings");
    export default { ok: true };
  `, { vue: {}, "@ontomato/sdk/panel": { mountPanel } });
  expect(exported.default).toEqual({ ok: true });
});
