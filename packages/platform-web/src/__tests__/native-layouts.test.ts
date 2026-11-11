import { describe, expect, it } from "vitest";
import { appDeclarations } from "../partition";
import { catalogPartitionFixture as appPartition } from "./fixtures";
import { closedAccess, generatedNavigation } from "./fixtures";

/*
 * The rail's sections and the business applications' order, straight from the task: the ontology applications, then the
 * business ones with the dashboards and the scheduled tasks among them, and the platform's own settings last.
 */
const t = (key: string) => key;
const declarations = appDeclarations(generatedNavigation(), closedAccess(["business-knowledge"]), appPartition(), t);
const named = (section: string) => declarations.filter((app) => app.rail === section).map((app) => app.id);

describe("the platform's applications", () => {
  it("opens knowledge governance in the conversation rather than feedback records", () => {
    expect(declarations.find(app => app.id === "governance")?.home).toBe("/governance/chat");
  });
  it("organizes the ontology menu into four layers with the capability library", () => {
    const ontology = appPartition().find(app => app.id === "ontology")!;
    expect(ontology.sections.map(section => section.key)).toEqual([
      "ontology:facts", "ontology:capabilities", "ontology:governance", "ontology:products",
    ]);
    expect(ontology.sections[0]!.paths).not.toContain("/ontology/assets/actions");
    expect(ontology.sections[1]!.paths).toEqual([
      "/ontology/assets/metrics", "/ontology/assets/functions", "/ontology/assets/actions", "/ontology/assets/workflows", "/ontology/capabilities",
    ]);
    expect(ontology.sections[2]!.paths).toEqual(["/ontology/knowledge", "/ontology/assets/capability-map"]);
    expect(ontology.sections[3]!.paths).toEqual([]);
    const menu = appDeclarations(generatedNavigation(), closedAccess(["ontology-modeling"]), appPartition(), t)
      .find(app => app.id === "ontology")!;
    expect(menu.groups?.find(group => group.key === "ontology:products")).toMatchObject({
      label: "platform.layers.products", pages: [],
    });
  });
  it("sits in three sections: the home and the everyday applications, the business ones, and the settings above the account", () => {
    expect(named("top")).toEqual(["home", "agents", "dashboards", "schedules", "browser"]);
    // 应用构建 comes after the operations diagnosis.
    expect(named("apps")).toEqual(["ontology", "governance", "operations", "app-builder"]);
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

});
