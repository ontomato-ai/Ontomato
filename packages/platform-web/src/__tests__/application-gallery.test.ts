import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installPanelApplicationOpener, panelNavigator } from "../panel-navigate";
import { catalogPartition } from "../native-layouts";

describe("application gallery panel entry and host application opener", () => {
  it("delegates application landing addresses to the installed shell opener", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/agents/chat", name: "Chat", component: { render: () => null } },
        { ...platformRoutes.unknown, component: { render: () => null } },
      ],
    });
    const opened: string[] = [];
    const uninstall = installPanelApplicationOpener((address, { beside }) => {
      if (address === "/__external/data-governance" || (!beside && address === "/settings")) {
        opened.push(address);
        return true;
      }
      return false;
    });
    try {
      const navigate = panelNavigator(router);
      await navigate("/__external/data-governance");
      await navigate("/settings");
      await navigate("/agents/chat?agentId=a1");
      expect(opened).toEqual(["/__external/data-governance", "/settings"]);
      expect(router.currentRoute.value.fullPath).toBe("/agents/chat?agentId=a1");
    } finally {
      uninstall();
    }
  });

  it("includes panel-backed application-gallery in catalogPartition without a native layout entry", () => {
    const partitions = catalogPartition([{
      id: "application-gallery",
      kind: "native",
      rail: "top",
      category: "business",
      sort: 2,
      entry: { path: "/applications", renderer: "application-gallery", home: "/applications" },
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Application gallery", "zh-CN": "应用广场" },
      descriptions: { en: "Discover apps", "zh-CN": "发现应用" },
      icon: "gallery",
      allowStandalone: false,
      panelUses: [{
        id: "application-gallery",
        pageKey: "application-gallery",
        panelId: "builtin-product-application-gallery",
        path: "/applications",
        names: { en: "Application gallery", "zh-CN": "应用广场" },
      }],
    }], "en");

    expect(partitions).toHaveLength(1);
    expect(partitions[0]).toMatchObject({
      id: "application-gallery",
      prefix: "/applications",
      home: "/applications",
    });
  });
});
