import { describe, expect, it } from "vitest";
import { BookOpen, MessageSquareText } from "lucide-vue-next";
import { appDeclarations } from "../partition";
import { catalogPartitionFixture as appPartition } from "./fixtures";
import { closedAccess, generatedNavigation } from "./fixtures";
import { catalogFixture } from "./fixtures";
import { catalogPartition } from "../native-layouts";
import { appAt } from "../apps";

const t = (key: string) => key;
const declarations = appDeclarations(generatedNavigation(), closedAccess(["business-knowledge"]), appPartition(), t);

describe("the platform's applications", () => {
  it("shows only the implemented workspace when an old workplace registration remains", () => {
    const catalog = catalogFixture();
    const workspace = catalog.find(app => app.id === "personal-workspace")!;
    const stale = { ...workspace, id: "workplace", entry: { path: "/workplace", renderer: "workplace" } };
    const partition = catalogPartition([...catalog, stale], "zh-CN");
    expect(
      partition.filter(app => app.id === "personal-workspace" || app.id === "workplace").map(app => app.id)
    ).toEqual(["personal-workspace"]);
  });
  it("omits stale native entries until their renderer layout is registered", () => {
    const application = {
      ...catalogFixture()[0]!, id: "edition-app", entry: { path: "/edition-app", renderer: "later-renderer" },
    };
    const pending = catalogPartition([application], "en");
    expect(pending).toEqual([]);
    const registered = catalogPartition([application], "en", {
      "later-renderer": { sections: [], home: "/edition-app/home" },
    });
    expect(appDeclarations(generatedNavigation(), closedAccess([]), registered, t)[0]?.home).toBe("/edition-app/home");
  });
  it("opens knowledge governance on business knowledge, which is the first page it still has", () => {
    // The feedback records are a page of the platform's administration, beside business knowledge in this application.
    const governancePages = [
      { path: "/governance/knowledge", titleKey: "nav.businessKnowledge", icon: BookOpen,
        permissions: ["business-knowledge"], group: "knowledge", ownHeader: true },
      { path: "/governance/feedback", titleKey: "nav.userFeedback", icon: MessageSquareText,
        permissions: ["business-knowledge"], group: "knowledge", ownHeader: true },
    ];
    const navigation = generatedNavigation();
    const opened = appDeclarations(
      { ...navigation, pages: [...navigation.pages, ...governancePages] },
      closedAccess(["business-knowledge"]), appPartition(), t,
    );
    const governance = opened.find(app => app.id === "governance")!;
    expect(governance.home).toBe("/governance/knowledge");
    expect(governance.foot).toBeNull();
    expect(governance.groups!.flatMap(section => section.pages.map(page => page.id)))
      .toEqual(["/governance/knowledge", "/governance/feedback"]);
  });
  it("provides a distinct gallery entry beside the personal home", () => {
    const gallery=declarations.find(app=>app.id==='application-gallery')!;
    expect(gallery.home).toBe('/applications');
    expect(gallery.home).not.toBe(declarations.find(app=>app.id==='home')?.home);
  });

  it("gives the dashboards and the scheduled tasks an application of their own, each at its own address", () => {
    const dashboards = declarations.find((app) => app.id === "dashboards")!;
    expect(dashboards.prefix).toBe("/dashboards");
    expect(dashboards.home).toBe("/dashboards");
    const schedules = declarations.find((app) => app.id === "schedules")!;
    expect(schedules.home).toBe("/schedules");
  });

});

it("opens and highlights a panel application under its application route", () => {
  const application = {
    ...catalogFixture()[0]!, id: "app-panels-trial-a", kind: "product" as const,
    entry: { renderer: "panels", path: "/panels-trial-a" },
  };
  const partition = catalogPartition([application], "en");
  const rail = appDeclarations(generatedNavigation(), closedAccess([]), partition, t);
  expect(rail[0]).toMatchObject({
    home: "/applications/app-panels-trial-a",
    prefix: "/applications/app-panels-trial-a",
    groups: [],
  });
  expect(appAt(rail, "/applications/app-panels-trial-a/tasks")?.id).toBe(application.id);
});

it("lists only named panel uses in declared order and gives one named use no menu", () => {
  const use = (path: string, names?: Record<string, string>) => ({
    id: path, pageKey: path, panelId: "shared-panel", path, access: { kind: "domain-member" as const }, names,
  });
  const application = {
    ...catalogFixture()[0]!, id: "app-panels-trial-b", kind: "product" as const,
    entry: { renderer: "panels", path: "/panels-trial-b" },
    panelUses: [
      use("/applications/app-panels-trial-b/tasks", { en: "Tasks", "zh-CN": "定时任务" }),
      use("/applications/app-panels-trial-b/detail"),
      use("/applications/app-panels-trial-b/summary", { en: "Task summary" }),
    ],
  };
  const declare = (app: typeof application) => appDeclarations(
    generatedNavigation(), closedAccess([]), catalogPartition([app], "zh-CN"), t,
  )[0]!;
  const both = declare(application);
  expect(both.frame).toBe("menu");
  expect(both.groups?.flatMap(group => group.pages)).toEqual([
    { id: "/applications/app-panels-trial-b/tasks", label: "定时任务" },
    { id: "/applications/app-panels-trial-b/summary", label: "Task summary" },
  ]);
  const single = declare({ ...application, panelUses: application.panelUses.slice(0, 2) });
  expect(single.frame).toBeUndefined();
  expect(single.groups).toEqual([]);
});
