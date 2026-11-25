import { describe, expect, it, vi } from "vitest";
import { allowsStandalone, builtinApplicationSchema } from "@ontomato/contracts/platform-identity";
import { workbenchApplications } from "../builtins";
import { registerWorkbenchApplications } from "../register";

vi.mock("../../product-panels/current", () => ({ validateApplicationPanelReferences: vi.fn() }));

describe("workbench built-in application allowStandalone defaults", () => {
  it("disables standalone open for all workbench built-in applications", () => {
    const byId = new Map(workbenchApplications.map(app => [app.id, builtinApplicationSchema.parse(app)]));

    for (const id of ["application-gallery", "home", "agents", "dashboards", "schedules", "operations", "app-builder"]) {
      expect(byId.get(id)?.allowStandalone, id).toBe(false);
      expect(allowsStandalone(byId.get(id)), id).toBe(false);
    }
  });

  it("preserves allowStandalone=false when registering built-in declarations with Java", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    await registerWorkbenchApplications({ register }, workbenchApplications, 2000);
    expect(register).toHaveBeenCalledTimes(1);
    const sent = register.mock.calls[0]![0] as typeof workbenchApplications;
    expect(sent.filter(app => app.allowStandalone === false).map(app => app.id).sort()).toEqual([
      "agents",
      "app-builder",
      "application-gallery",
      "dashboards",
      "home",
      "operations",
      "schedules",
    ]);
  });
});
