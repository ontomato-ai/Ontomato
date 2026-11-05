import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { PlatformShell, PlatformRail, PlatformAccountMenu, AppPanel, AppPanelPages } from "..";
import type { PlatformAccount, PlatformApp, PlatformPreferences, PlatformShellLabels } from "../types";

const labels: PlatformShellLabels = {
  expandRail: "Expand applications",
  collapseRail: "Collapse applications",
  applications: "Applications",
  brand: "Ontomato",
  account: "Account",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  signOut: "Sign out",
  opensInNewTab: "Opens in a new tab",
  pages: "Pages",
};

const apps: PlatformApp[] = [
  { id: "agents", label: "Agent Platform", icon: "agents" },
  { id: "diagnosis", label: "Operations diagnosis", icon: "diagnosis" },
  { id: "knowledge", label: "Knowledge governance", icon: "knowledge" },
  { id: "objects", label: "Object browser", icon: "objects" },
  { id: "ontology", label: "Ontology manager", icon: "ontology" },
  { id: "schedule", label: "Scheduled tasks", icon: "schedule" },
  { id: "permissions", label: "Permissions", icon: "permissions" },
  { id: "settings", label: "System settings", icon: "settings" },
  { id: "governance", label: "Data governance platform", icon: "governance", href: "https://example.test/governance" },
];

function preferences(overrides: Partial<PlatformPreferences> = {}): PlatformPreferences {
  return {
    locales: ["en"],
    locale: "en",
    setLocale: vi.fn(),
    theme: "light",
    setTheme: vi.fn(),
    ...overrides,
  };
}

const account: PlatformAccount = { userName: "Ada", signOut: vi.fn() };

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function mount(component: unknown, props: Record<string, unknown>, slots: Record<string, () => unknown> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({ render: () => h(component as never, props, slots) });
  app.mount(root);
  await nextTick();
  return root;
}

/** The order the rail lists, straight from the task: no grouping, app-builder absent, external application last. */
const expectedOrder = [
  "Agent Platform",
  "Operations diagnosis",
  "Knowledge governance",
  "Object browser",
  "Ontology manager",
  "Scheduled tasks",
  "Permissions",
  "System settings",
  "Data governance platform",
];

describe("platform rail", () => {
  it("lists the applications flat, in the agreed order, with the external one marked", async () => {
    const root = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false });
    const rows = [...root.querySelectorAll(".rail-row")];
    expect(rows.map((row) => row.textContent?.replace("Opens in a new tab", "").trim())).toEqual(expectedOrder);
    // The external application is a link to another product and opens in a new tab.
    const external = rows.at(-1) as HTMLAnchorElement;
    expect(external.tagName).toBe("A");
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
    expect(external.classList.contains("active")).toBe(false);
  });

  it("marks the current application with the rail's selected band", async () => {
    const root = await mount(PlatformRail, { apps, activeAppId: "ontology", account, preferences: preferences(), labels, collapsed: false });
    const active = [...root.querySelectorAll(".rail-row.active")];
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("Ontology manager");
    expect(active[0].getAttribute("aria-current")).toBe("page");
  });

  it("shows an application declared but not built as disabled rather than hiding it", async () => {
    const withPending: PlatformApp[] = [
      ...apps,
      { id: "builder", label: "App builder", icon: "builder", unavailableHint: "Coming soon" },
    ];
    const root = await mount(PlatformRail, { apps: withPending, activeAppId: null, account, preferences: preferences(), labels, collapsed: false });
    const pending = root.querySelector(".rail-row.unavailable");
    expect(pending).not.toBeNull();
    expect(pending?.getAttribute("aria-disabled")).toBe("true");
    expect(pending?.getAttribute("title")).toBe("Coming soon");
  });

  it("collapses to icons only, keeping every accessible name", async () => {
    const root = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false });
    expect(root.querySelectorAll(".rail-label")).toHaveLength(apps.length);
    expect(root.querySelectorAll(".rail-row button, .rail-row a").length + root.querySelectorAll("button.rail-row").length).toBeGreaterThan(0);
    app?.unmount();

    const collapsedRoot = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: true });
    // No visible names, but each row still carries its label for assistive technology and a tooltip.
    expect(collapsedRoot.querySelectorAll(".rail-label")).toHaveLength(0);
    const buttons = [...collapsedRoot.querySelectorAll<HTMLElement>("button.rail-row")];
    expect(buttons).toHaveLength(apps.length - 1);
    buttons.forEach((button, index) => {
      expect(button.getAttribute("aria-label")).toBe(apps[index].label);
      expect(button.getAttribute("title")).toBe(apps[index].label);
    });
  });

  it("reports the selected application and the collapse toggle", async () => {
    const onSelect = vi.fn();
    const onCollapse = vi.fn();
    const root = await mount(PlatformRail, {
      apps,
      activeAppId: "agents",
      account,
      preferences: preferences(),
      labels,
      collapsed: false,
      onSelectApp: onSelect,
      "onUpdate:collapsed": onCollapse,
    });
    const target = [...root.querySelectorAll<HTMLButtonElement>("button.rail-row")].find((b) =>
      b.textContent?.includes("Object browser"),
    );
    target?.click();
    expect(onSelect).toHaveBeenCalledWith("objects");
    root.querySelector<HTMLButtonElement>(".rail-toggle")?.click();
    expect(onCollapse).toHaveBeenCalledWith(true);
  });
});

describe("account menu", () => {
  it("offers language, theme and sign out", async () => {
    const prefs = preferences({ locales: ["en", "zh-CN"], locale: "en" });
    const root = await mount(PlatformAccountMenu, { account, preferences: prefs, labels });
    const rows = [...root.querySelectorAll(".menu-row")];
    expect(rows.map((row) => row.textContent?.trim())).toEqual(["en", "zh-CN", "Dark", "Sign out"]);
  });

  it("hides the language rows when the edition has a single language", async () => {
    const root = await mount(PlatformAccountMenu, { account, preferences: preferences(), labels });
    expect(root.querySelector(".menu-heading")).toBeNull();
    expect([...root.querySelectorAll(".menu-row")].map((row) => row.textContent?.trim())).toEqual(["Dark", "Sign out"]);
  });

  it("switches theme and language through the host's preferences, and signs out", async () => {
    const setTheme = vi.fn();
    const setLocale = vi.fn();
    const signOut = vi.fn();
    const onClose = vi.fn();
    const prefs = preferences({ locales: ["en", "zh-CN"], setTheme, setLocale, theme: "dark" });
    const root = await mount(PlatformAccountMenu, {
      account: { userName: "Ada", signOut },
      preferences: prefs,
      labels,
      onClose,
      onSignOut: signOut,
    });
    const rows = [...root.querySelectorAll<HTMLButtonElement>(".menu-row")];
    rows.find((row) => row.textContent?.includes("Light"))?.click();
    expect(setTheme).toHaveBeenCalledWith("light");
    rows[0].click();
    expect(setLocale).toHaveBeenCalledWith("en");
    rows.at(-1)?.click();
    expect(signOut).toHaveBeenCalled();
  });
});

describe("application panel", () => {
  it("draws the application name and its own settings entry at the foot", async () => {
    const onSettings = vi.fn();
    const root = await mount(
      AppPanel,
      {
        panel: { id: "agents", label: "Agent Platform", settings: { id: "agent-settings", label: "Agent settings", icon: "settings" } },
        labels,
        onOpenSettings: onSettings,
      },
      { default: () => h("div", { class: "panel-slot" }, "contents") },
    );
    expect(root.querySelector(".panel-title")?.textContent).toBe("Agent Platform");
    expect(root.querySelector(".panel-slot")).not.toBeNull();
    root.querySelector<HTMLButtonElement>(".settings-row")?.click();
    expect(onSettings).toHaveBeenCalledWith("agent-settings");
  });

  it("leaves the foot out when the application has no settings entry", async () => {
    const root = await mount(AppPanel, { panel: { id: "objects", label: "Object browser" }, labels });
    expect(root.querySelector(".panel-footer")).toBeNull();
  });

  it("lists pages by group and marks the current one with the panel's selected band", async () => {
    const onSelect = vi.fn();
    const root = await mount(AppPanelPages, {
      groups: [
        { key: "ontology", label: "Ontology", pages: [{ id: "/objects", label: "Object types", icon: "objects", count: 12 }] },
        { key: "assets", label: "Assets", pages: [{ id: "/metrics", label: "Metric views", icon: "pages" }] },
      ],
      activePageId: "/objects",
      onSelectPage: onSelect,
    });
    expect([...root.querySelectorAll(".group-heading")].map((g) => g.textContent)).toEqual(["Ontology", "Assets"]);
    const active = root.querySelector(".page-row.active");
    expect(active?.textContent).toContain("Object types");
    expect(active?.querySelector(".page-count")?.textContent).toBe("12");
    root.querySelector<HTMLButtonElement>(".page-row.active")?.click();
    expect(onSelect).toHaveBeenCalledWith("/objects");
  });

  it("shows a page not yet moved into the application as disabled", async () => {
    const root = await mount(AppPanelPages, {
      groups: [{ key: "knowledge", label: "Knowledge", pages: [{ id: "feedback", label: "User feedback", icon: "pages", unavailableHint: "Moving here" }] }],
      activePageId: null,
    });
    const row = root.querySelector(".page-row.unavailable");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.getAttribute("title")).toBe("Moving here");
  });
});

describe("platform shell", () => {
  it("remembers the collapsed rail and lets a controlled value win", async () => {
    localStorage.setItem("ontomato.platform.railCollapsed", "true");
    const root = await mount(
      PlatformShell,
      { apps, activeAppId: "agents", account, preferences: preferences(), labels },
      { panel: () => h("div", { class: "panel-slot" }), default: () => h("div", { class: "workspace-slot" }) },
    );
    expect(root.querySelector(".platform-shell")?.classList.contains("rail-collapsed")).toBe(true);
    expect(root.querySelector(".panel-slot")).not.toBeNull();
    expect(root.querySelector(".workspace-slot")).not.toBeNull();
  });

  it("keeps an explicit expansion even when the stored value says collapsed", async () => {
    localStorage.setItem("ontomato.platform.railCollapsed", "true");
    const root = await mount(
      PlatformShell,
      { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false },
      { panel: () => h("div") },
    );
    expect(root.querySelector(".platform-shell")?.classList.contains("rail-collapsed")).toBe(false);
  });

  it("writes the reader's choice back and reports it to the host", async () => {
    const onUpdate = vi.fn();
    const root = await mount(
      PlatformShell,
      {
        apps,
        activeAppId: "agents",
        account,
        preferences: preferences(),
        labels,
        "onUpdate:collapsed": onUpdate,
      },
      { panel: () => h("div") },
    );
    const shell = root.querySelector(".platform-shell");
    const startedCollapsed = shell?.classList.contains("rail-collapsed") === true;
    root.querySelector<HTMLButtonElement>(".rail-toggle")?.click();
    await nextTick();
    // The toggle flips whichever state the shell started in, and that choice is what gets remembered.
    expect(onUpdate).toHaveBeenLastCalledWith(!startedCollapsed);
    expect(localStorage.getItem("ontomato.platform.railCollapsed")).toBe(String(!startedCollapsed));
    expect(shell?.classList.contains("rail-collapsed")).toBe(!startedCollapsed);

    root.querySelector<HTMLButtonElement>(".rail-toggle")?.click();
    await nextTick();
    expect(onUpdate).toHaveBeenLastCalledWith(startedCollapsed);
    expect(localStorage.getItem("ontomato.platform.railCollapsed")).toBe(String(startedCollapsed));
    expect(shell?.classList.contains("rail-collapsed")).toBe(startedCollapsed);
  });

  it("starts collapsed on a narrow screen until the reader expands it", async () => {
    // The narrow-screen default is the only reason the rail may start collapsed on a fresh load.
    const root = await mount(
      PlatformShell,
      { apps, activeAppId: "agents", account, preferences: preferences(), labels },
      { panel: () => h("div") },
    );
    expect(window.matchMedia("(max-width: 1279px)").matches).toBe(true);
    expect(root.querySelector(".platform-shell")?.classList.contains("rail-collapsed")).toBe(true);
  });
});
