import { describe, expect, it } from "vitest";
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

describe("the operations application's user feedback", () => {
  // The entry operations declares for user feedback (big main's ruling, 2026-11-21): no menu name, so no menu place.
  // Production navigation does not list /ops/turn (ObserveLayout owns those routes), so test against real generatedNavigation().
  const catalog = catalogFixture();
  const withoutFeedback = catalog.map((app) => app.id !== "operations" ? app : { ...app, panelUses: [] });
  const navigation = generatedNavigation();
  const operations = (granted: string[], apps = catalog) =>
    appDeclarations(navigation, closedAccess(granted), catalogPartition(apps, "en"), t).find((app) => app.id === "operations")!;

  it("opens on user feedback for a reader who may open none of its listed pages but has the entry", () => {
    expect(operations(["user-feedback"]).home).toBe("/ops/feedback");
  });

  it("keeps opening on turn evidence for an observer, and lists no feedback in its menu", () => {
    const observer = operations(["observer", "user-feedback"]);
    expect(observer.home).toBe("/ops/turn");
    expect(observer.groups!.flatMap((group) => group.pages.map((page) => page.id))).not.toContain("/ops/feedback");
  });

  it("does not open on user feedback for a reader the catalogue gives no such entry", () => {
    expect(operations(["user-feedback"], withoutFeedback).home).not.toBe("/ops/feedback");
  });
});

it("gives a panel entry's row the count its entry declares, and keeps a native page's own count for an entry declaring none", () => {
  const catalog = catalogFixture().map(app => app.id !== "ontology" ? app : {
    ...app,
    panelUses: (app.panelUses ?? []).map(use => use.id === "ontology-functions" ? { ...use, count: { member: "list", data: "rows" } } : use),
  });
  // The shell's reading of the declared read (its own module's tests cover the read).
  const read = (applicationId: string, use: { id: string }) => `${applicationId}/${use.id}` === "ontology/ontology-functions" ? 63 : null;
  const ontology = catalogPartition(catalog, "zh-CN", {}, read).find(app => app.id === "ontology")!;
  expect(ontology.entries?.get("/ontology/assets/functions")).toMatchObject({ count: 63 });
  // An entry that declares nothing carries no count of its own: the row it stands in keeps the page's.
  const knowledge = ontology.entries?.get("/ontology/knowledge");
  expect(knowledge && "count" in knowledge).toBe(false);
});
