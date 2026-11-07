import { describe, expect, it } from "vitest";
import { appDeclarations } from "../partition";
import { appPartition } from "../app-partition";
import { closedAccess, generatedNavigation } from "./fixtures";

/*
 * The rail's sections and the business applications' order, straight from the task: the ontology applications, then the
 * business ones with the dashboards and the scheduled tasks among them, and the platform's own settings last.
 */
const t = (key: string) => key;
const declarations = appDeclarations(generatedNavigation(), closedAccess([]), appPartition(), t);
const named = (section: string) => declarations.filter((app) => app.rail === section).map((app) => app.id);

describe("the platform's applications", () => {
  it("sits in three sections: the ontology applications, the business ones, and the settings above the account", () => {
    expect(named("top")).toEqual(["agents", "dashboards", "schedules", "browser"]);
    expect(named("apps")).toEqual(["ontology", "governance", "operations"]);
    expect(named("bottom")).toEqual(["settings"]);
  });

  it("gives the dashboards and the scheduled tasks an application of their own, each at its own address", () => {
    const dashboards = declarations.find((app) => app.id === "dashboards")!;
    expect(dashboards.prefix).toBe("/dashboards");
    expect(dashboards.home).toBe("/dashboards");
    const schedules = declarations.find((app) => app.id === "schedules")!;
    expect(schedules.home).toBe("/schedules");
    // Neither is listed under the agent platform any more: they are applications, not pages of one.
    const agents = declarations.find((app) => app.id === "agents")!;
    expect(agents.groups).toEqual([]);
  });

  it("places an edition's own application in the section it declares", () => {
    const own = {
      id: "permissions",
      labelKey: "platform.permissions",
      icon: "permissions",
      rail: "bottom" as const,
      prefix: "/permissions",
      panel: "pages" as const,
      sections: [{ key: "permissions:all", titleKey: "nav.permissionCenter", paths: ["/permissions"] }],
    };
    const withOwn = appDeclarations(generatedNavigation(), closedAccess([]), appPartition({ own: [own] }), t);
    expect(withOwn.filter((app) => app.rail === "bottom").map((app) => app.id)).toEqual(["permissions", "settings"]);
    expect(withOwn.filter((app) => app.rail === "apps").map((app) => app.id)).not.toContain("permissions");
  });
});
