import { expect, it } from "vitest";
import { applicationMenuSections, menuLabel, type ApplicationMenu } from "../../../../../packages/apps-sdk/src/base/app-menu";

/*
 * The frame's menu (design §3): order and take the entries from Java's `resolveEntry.menu` alone — ungrouped entries
 * first in their own order, then each group by its declared `sort`, each group's entries in their own order.
 */

/** What Java answers for the object browser today: one group, one entry (`notes/entry-http/200-grouped.json`). */
const browserMenu: ApplicationMenu = {
  groups: [{ key: "browse", names: { en: "Browse" }, sort: 0 }],
  panelUses: [
    { id: "browse", pageKey: "browse", path: "/browser/list", names: { en: "Browse" }, groupKey: "browse" },
  ],
};

it("draws Java's menu as one section per declared group, in the reader's language", () => {
  expect(applicationMenuSections(browserMenu, "en")).toEqual([
    { key: "browse", label: "Browse", entries: [{ id: "browse", pageKey: "browse", path: "/browser/list", label: "Browse" }] },
  ]);
});

it("puts entries in no group first, then each group by its declared sort, keeping each order as Java holds it", () => {
  const menu: ApplicationMenu = {
    groups: [
      { key: "reports", names: { en: "Reports", "zh-CN": "报表" }, sort: 20 },
      { key: "orders", names: { en: "Orders", "zh-CN": "订单" }, sort: 10 },
    ],
    panelUses: [
      { id: "orders-open", pageKey: "orders", path: "/app/orders/open", names: { en: "Open orders" }, groupKey: "orders" },
      { id: "home", pageKey: "home", path: "/app/home", names: { en: "Home" } },
      { id: "orders-all", pageKey: "orders-all", path: "/app/orders", names: { en: "All orders" }, groupKey: "orders" },
      { id: "reports-sales", pageKey: "sales", path: "/app/reports/sales", names: { en: "Sales" }, groupKey: "reports" },
      { id: "about", pageKey: "about", path: "/app/about", names: { en: "About" } },
    ],
  };
  expect(applicationMenuSections(menu, "en").map((section) => [section.key, section.label, section.entries.map((entry) => entry.id)]))
    .toEqual([
      [null, "", ["home", "about"]],
      ["orders", "Orders", ["orders-open", "orders-all"]],
      ["reports", "Reports", ["reports-sales"]],
    ]);
  expect(applicationMenuSections(menu, "zh-CN").map((section) => section.label)).toEqual(["", "订单", "报表"]);
});

it("never offers an entry that carries no name, and puts an entry whose group is gone among the ungrouped", () => {
  const menu: ApplicationMenu = {
    groups: [{ key: "orders", names: { en: "Orders" }, sort: 0 }],
    panelUses: [
      { id: "unnamed", pageKey: "unnamed", path: "/app/unnamed" },
      { id: "home", pageKey: "home", path: "/app/home", names: { en: "Home" } },
      { id: "orphan", pageKey: "orphan", path: "/app/orphan", names: { en: "Orphan" }, groupKey: "withdrawn" },
    ],
  };
  expect(applicationMenuSections(menu, "en")).toEqual([
    {
      key: null, label: "",
      entries: [
        { id: "home", pageKey: "home", path: "/app/home", label: "Home" },
        { id: "orphan", pageKey: "orphan", path: "/app/orphan", label: "Orphan" },
      ],
    },
  ]);
});

it("names an entry in the reader's language, falling back to English, which Java requires of every name", () => {
  expect(menuLabel({ en: "Browse", "zh-CN": "浏览" }, "zh-CN")).toBe("浏览");
  expect(menuLabel({ en: "Browse", "zh-CN": "浏览" }, "de")).toBe("Browse");
});
