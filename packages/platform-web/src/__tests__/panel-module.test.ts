import { expect, it } from "vitest";
import { runPanelModule } from "../panel-module";

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
