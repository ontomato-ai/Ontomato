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
    const home = catalog.find(app => app.id === "home")!;
    const workspace = { ...home, id: "personal-workspace", panelUses: [], entry: { path: "/workspace", renderer: "personal-workspace" } };
    const stale = { ...workspace, id: "workplace", entry: { path: "/workplace", renderer: "workplace" } };
    const partition = catalogPartition([...catalog, workspace, stale], "zh-CN");
    expect(
      partition.filter(app => app.id === "personal-workspace" || app.id === "workplace").map(app => app.id)
    ).toEqual(["personal-workspace"]);
  });
  it("omits stale native entries until their renderer layout is registered", () => {
    const application = {
      ...catalogFixture()[0]!, id: "edition-app", panelUses: [], entry: { path: "/edition-app", renderer: "later-renderer" },
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
    expect(schedules.framePanelId).toBe("builtin-product-platform-frame");
    expect(schedules.groups).toEqual([]);
  });

  it("admits fully panel-backed built-in applications without native-layouts and lands home on the first visible named entry", () => {
    const permissionsApp = {
      ...catalogFixture()[0]!,
      id: "permissions",
      kind: "native" as const,
      framePanelId: "builtin-product-platform-frame",
      entry: { path: "/permissions", renderer: "permissions" },
      panelUses: [
        {
          id: "permissions-member-detail",
          pageKey: "permissions-member-detail",
          panelId: "builtin-product-governance-member-detail",
          path: "/permissions/members/detail",
          access: { permissionCode: "user-management" },
        },
        {
          id: "permissions-roles",
          pageKey: "permissions-roles",
          panelId: "builtin-product-governance-roles",
          path: "/permissions/roles",
          icon: "user-cog",
          names: { en: "Roles", "zh-CN": "角色" },
          access: { permissionCode: "role-management" },
        },
      ],
    };
    const partition = catalogPartition([permissionsApp], "zh-CN");
    const [declared] = appDeclarations(generatedNavigation(), closedAccess([]), partition, t);
    expect(declared?.id).toBe("permissions");
    expect(declared?.framePanelId).toBe("builtin-product-platform-frame");
    expect(declared?.groups).toEqual([]);
    expect(declared?.home).toBe("/permissions/roles");
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

it("propagates framePanelId and leaves panel application menus to their frame panel", () => {
  const use = (path: string, names?: Record<string, string>) => ({
    id: path, pageKey: path, panelId: "shared-panel", path, access: { kind: "domain-member" as const }, names,
  });
  const application = {
    ...catalogFixture()[0]!, id: "app-panels-trial-b", kind: "product" as const,
    framePanelId: "builtin-product-platform-frame",
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
  expect(both.framePanelId).toBe("builtin-product-platform-frame");
  expect(both.groups).toEqual([]);
  const single = declare({ ...application, panelUses: application.panelUses.slice(0, 2) });
  expect(single.framePanelId).toBe("builtin-product-platform-frame");
  expect(single.groups).toEqual([]);
});

describe("the operations application's unified platform frame", () => {
  const catalog = catalogFixture();
  const filterPanelUses = (granted: readonly string[]) =>
    catalog.map((app) =>
      app.id !== "operations"
        ? app
        : {
            ...app,
            panelUses: (app.panelUses ?? []).filter(
              (entry) => !("permissionCode" in entry.access) || granted.includes(entry.access.permissionCode),
            ),
          },
    );
  const withoutFeedback = catalog.map((app) => app.id !== "operations" ? app : { ...app, panelUses: [] });
  const navigation = generatedNavigation();
  const operations = (granted: string[], apps = filterPanelUses(granted)) =>
    appDeclarations(navigation, closedAccess(granted), catalogPartition(apps, "en"), t).find((app) => app.id === "operations")!;

  it("opens on user feedback for a reader who holds only user-feedback", () => {
    const feedbackOnly = operations(["user-feedback"]);
    expect(feedbackOnly.framePanelId).toBe("builtin-product-platform-frame");
    expect(feedbackOnly.home).toBe("/ops/feedback");
    expect(feedbackOnly.groups!.flatMap((group) => group.pages.map((page) => page.id))).toEqual(["/ops/feedback"]);
  });

  it("opens on turn evidence for an observer and lists unified frame menu entries including feedback when granted", () => {
    const observer = operations(["observer", "user-feedback"]);
    expect(observer.framePanelId).toBe("builtin-product-platform-frame");
    expect(observer.home).toBe("/ops/turn");
    expect(observer.groups!.flatMap((group) => group.pages.map((page) => page.id))).toEqual(
      expect.arrayContaining(["/ops/knowledge", "/ops/feedback"]),
    );
  });

  it("does not open on user feedback for a reader the catalogue gives no such entry", () => {
    expect(operations(["user-feedback"], withoutFeedback).home).not.toBe("/ops/feedback");
  });
});

describe("system settings catalog-driven frame with mixed panel and native entries", () => {
  it("uses zero hostMenu groups and picks landing home in menu group order including native-only accounts", () => {
    const settingsApp = {
      id: "settings",
      kind: "native" as const,
      names: { en: "System settings", "zh-CN": "系统设置" },
      descriptions: { en: "Models, general settings, connections, logs and monitoring" },
      icon: "settings",
      rail: "bottom" as const,
      category: "admin" as const,
      sort: 20,
      entry: { path: "/settings", renderer: "settings" },
      entryAccess: ["system-config", "authorization-management", "audit-logs", "system-monitoring", "mcp-service"],
      scheduleAdapter: null,
      releaseId: null,
      framePanelId: "builtin-product-platform-frame",
      allowStandalone: false,
      groups: [
        { key: "models", names: { en: "Models" }, sort: 0 },
        { key: "system-settings", names: { en: "System" }, sort: 1 },
        { key: "records", names: { en: "Logs and monitoring" }, sort: 3 },
      ],
      panelUses: [
        {
          id: "audit-log",
          pageKey: "audit-log",
          panelId: "builtin-product-audit-log",
          path: "/settings/records/audit-log",
          icon: "clipboard-list",
          groupKey: "records",
          access: { permissionCode: "audit-logs" },
          names: { en: "Audit log" },
        },
        {
          id: "system-monitor",
          pageKey: "system-monitor",
          kind: "native" as const,
          path: "/settings/records/system-monitor",
          icon: "activity",
          groupKey: "records",
          access: { permissionCode: "system-monitoring" },
          names: { en: "System monitoring" },
        },
        {
          id: "authorization",
          pageKey: "authorization",
          kind: "native" as const,
          path: "/settings/system-config/authorization",
          icon: "key-round",
          groupKey: "system-settings",
          access: { permissionCode: "authorization-management" },
          names: { en: "License" },
        },
      ],
    };

    const navigation = generatedNavigation();
    const withAuthAndAudit = appDeclarations(navigation, closedAccess(["authorization-management", "audit-logs"]), catalogPartition([settingsApp], "en"), t)
      .find((app) => app.id === "settings")!;
    expect(withAuthAndAudit.framePanelId).toBe("builtin-product-platform-frame");
    expect(withAuthAndAudit.groups).toEqual([]);
    // Even though authorization is appended after audit-log, system-settings sorts ahead of records.
    expect(withAuthAndAudit.home).toBe("/settings/system-config/authorization");

    const monitorOnlyApp = { ...settingsApp, panelUses: [settingsApp.panelUses[1]!] };
    const monitorOnly = appDeclarations(navigation, closedAccess(["system-monitoring"]), catalogPartition([monitorOnlyApp], "en"), t)
      .find((app) => app.id === "settings")!;
    expect(monitorOnly.framePanelId).toBe("builtin-product-platform-frame");
    expect(monitorOnly.groups).toEqual([]);
    expect(monitorOnly.home).toBe("/settings/records/system-monitor");
  });
});
