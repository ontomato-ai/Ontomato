import { expect, it } from "vitest";
import { panelDefinitionContentSchema } from "@ontomato/contracts/product-panels";
import { directProjectionPortsSchema } from "@ontomato/contracts/panel-projection";
import { APPLICATION_PANEL_USE } from "@ontomato/contracts/platform-object-types";
import html from "../builtin-panels/app-frame/panel.html?raw";
import manifest from "../builtin-panels/app-frame/panel.json";
import projections from "../builtin-panels/app-frame/projections.json";

/*
 * The platform's default frame (design §3, eighth section: "the platform's default frame is an ordinary panel
 * material"): it draws the application's entry menu and holds the entry the platform resolved, and it opens an entry by
 * the panel's own event. It is a trusted built-in of the version, so it is data — the host draws it, nobody registers it
 * in a domain.
 */
const panel = { content: { html }, manifest };

it("the default frame is a panel material the contract accepts, with no code of its own", () => {
  const parsed = panelDefinitionContentSchema.parse(panel);
  expect("module" in parsed.content).toBe(false);
  expect(parsed.manifest.state).toEqual({});
});

it("it holds the entry the platform resolved and the menu beside it, and nothing else", () => {
  const { members } = panelDefinitionContentSchema.parse(panel).manifest;
  expect(members.content).toEqual({
    target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } },
    params: { width: "full" },
  });
  expect(members.menu).toEqual({ target: { projectionId: "builtin-app-menu" }, params: { width: "full" } });
  // The layout places exactly those two members.
  expect(html).toContain('<panel-member ref="menu">');
  expect(html).toContain('<panel-member ref="content">');
});

it("picking an entry in the menu opens that entry, and the frame navigates nothing itself", () => {
  const { events } = panelDefinitionContentSchema.parse(panel).manifest;
  expect(events.go).toEqual({
    on: { member: "menu", output: "activated" },
    do: { open: { mode: "entry", entry: { event: true } } },
  });
  expect(Object.keys(events)).toEqual(["go"]);
});

it("the menu projection reads the entries Java admitted, for the application the frame is in", () => {
  const menu = directProjectionPortsSchema.parse(projections.menu);
  expect(menu.componentId).toBe("@ontomato/sdk:AppMenu");
  expect(menu.outputs).toEqual({ activated: { kind: "object", objectType: APPLICATION_PANEL_USE } });
  expect(menu.data).toEqual({
    menu: {
      source: { type: { kind: "PlatformObjectType", id: APPLICATION_PANEL_USE } },
      read: "visible",
      params: {},
    },
  });
});
