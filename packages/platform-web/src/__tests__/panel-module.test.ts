import { expect, it } from "vitest";
import { runPanelModule } from "../panel-module";

it("runs a panel's literal dynamic import against the same namespace as its static import", async () => {
  const mountPanel = () => undefined;
  await expect(runPanelModule(`
    import { mountPanel } from "@ontomato/sdk/panel";
    const sdk = await import("@ontomato/sdk/panel");
    if (mountPanel !== sdk.mountPanel) throw new Error("The two imports supplied different bindings");
  `, { vue: {}, "@ontomato/sdk/panel": { mountPanel } })).resolves.toBeUndefined();
});
