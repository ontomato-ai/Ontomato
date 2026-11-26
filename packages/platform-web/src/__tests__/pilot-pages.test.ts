import { describe, expect, it, vi } from "vitest";

vi.mock("../catalog", () => ({
  builtinApplicationForPath: () => null,
  panelEntryApplication: () => null,
}));
vi.mock("../pages/PanelApplicationRoute.vue", () => ({ default: { render: () => null } }));

import { pilotPageResolver } from "../pilot-pages";

describe("pages opened without the platform catalog", () => {
  it("opens a saved dashboard through its real application and preserves navigation", () => {
    const navigate = vi.fn();
    const address = "/dashboards?dashboardId=saved-board";
    const page = pilotPageResolver(navigate)(address);
    expect(page).toMatchObject({
      id: "panel-application",
      instance: "/dashboards",
      props: { applicationId: "dashboards", address, navigate },
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(pilotPageResolver(navigate)("/dashboards-unregistered")).toBeNull();
  });
});
