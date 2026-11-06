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
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
};

/** The enterprise rail in display order: the ontology applications, the business ones, the platform's own settings. */
const apps: PlatformApp[] = [
  { id: "ontology", label: "Ontology manager", icon: "ontology", rail: "top" },
  { id: "objects", label: "Object browser", icon: "objects", rail: "top" },
  { id: "agents", label: "Agent Platform", icon: "agents" },
  { id: "diagnosis", label: "Operations diagnosis", icon: "diagnosis" },
  { id: "knowledge", label: "Knowledge governance", icon: "knowledge" },
  { id: "dashboards", label: "Dashboards", icon: "pages" },
  { id: "schedule", label: "Scheduled tasks", icon: "schedule" },
  { id: "governance", label: "Data governance platform", icon: "governance", href: "https://example.test/governance" },
  { id: "permissions", label: "Permissions", icon: "permissions", rail: "bottom" },
  { id: "settings", label: "System settings", icon: "settings", rail: "bottom" },
];

/** The same rail without the enterprise edition's permission centre and external application. */
const openSourceApps: PlatformApp[] = apps.filter((app) => app.id !== "permissions" && app.id !== "governance");

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

/**
 * The rails of both editions, written out here (the task asks for the names to be fixed in the test): the ontology
 * applications first, then the business ones with the external application last among them, and the platform's own
 * settings above the account. No section carries a group name.
 */
const enterpriseRails: string[][] = [
  ["Ontology manager", "Object browser"],
  ["Agent Platform", "Operations diagnosis", "Knowledge governance", "Dashboards", "Scheduled tasks", "Data governance platform"],
  ["Permissions", "System settings"],
];
const openSourceRails: string[][] = [
  ["Ontology manager", "Object browser"],
  ["Agent Platform", "Operations diagnosis", "Knowledge governance", "Dashboards", "Scheduled tasks"],
  ["System settings"],
];

/** The section each row is in, read off the rendered dividers. */
function railsOf(root: HTMLElement) {
  const sections: string[][] = [];
  let current: string[] = [];
  for (const node of root.querySelectorAll(".rail-scroll > *")) {
    if (node.classList.contains("rail-divider")) {
      if (current.length > 0) sections.push(current);
      current = [];
      continue;
    }
    for (const row of node.querySelectorAll(".rail-row")) {
      current.push(row.textContent?.replace("Opens in a new tab", "").trim() ?? "");
    }
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

describe("platform rail", () => {
  it("lists the enterprise applications in three sections, with the external one last among the business ones", async () => {
    const root = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false });
    expect(railsOf(root)).toEqual(enterpriseRails);
    // The external application is a link to another product and opens in a new tab; nothing selects it.
    const external = root.querySelector<HTMLAnchorElement>(".rail-row.external");
    expect(external?.textContent?.trim()).toContain("Data governance platform");
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toContain("noopener");
    expect(external?.classList.contains("active")).toBe(false);
  });

  it("lists the open-source rail without the permission centre and the external application", async () => {
    const root = await mount(PlatformRail, { apps: openSourceApps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false });
    expect(railsOf(root)).toEqual(openSourceRails);
    expect(root.querySelector(".rail-row.external")).toBeNull();
  });

  it("opens an external application whose address the host resolves, as a button, without selecting it", async () => {
    const open = vi.fn();
    const onSelect = vi.fn();
    const withSigned = [...apps, { id: "governance-sso", label: "Governance (signed jump)", icon: "governance", open }];
    const root = await mount(PlatformRail, {
      apps: withSigned,
      activeAppId: "agents",
      account,
      preferences: preferences(),
      labels,
      collapsed: false,
      onSelectApp: onSelect,
    });
    const row = [...root.querySelectorAll<HTMLElement>(".rail-row.external")].find((node) =>
      node.textContent?.includes("Governance (signed jump)"),
    );
    // A target the host must sign first is a button: the host opens the tab when it has the address.
    expect(row?.tagName).toBe("BUTTON");
    row?.click();
    expect(open).toHaveBeenCalledTimes(1);
    // An external application is never the current application.
    expect(onSelect).not.toHaveBeenCalled();
    expect(row?.classList.contains("active")).toBe(false);
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

  /*
   * Collapsed — the default — the rail is the icon column: names appear on hover only, and the expand control replaces
   * the brand mark at the top (DESIGN.md "Applications and shells").
   */
  it("collapses to icons only, keeping every accessible name and putting the expand control at the top", async () => {
    const expanded = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false });
    expect(expanded.querySelectorAll(".rail-label")).toHaveLength(apps.length);
    expect(expanded.querySelector(".brand-name")?.textContent).toBe("Ontomato");
    expect(expanded.querySelector(".rail-brand .rail-mark, .brand-mark")).not.toBeNull();
    expect(expanded.querySelector(".rail-toggle")?.getAttribute("aria-label")).toBe(labels.collapseRail);
    app?.unmount();

    const collapsedRoot = await mount(PlatformRail, { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: true });
    // No visible names, but each row still carries its label for assistive technology and a tooltip.
    expect(collapsedRoot.querySelectorAll(".rail-label")).toHaveLength(0);
    expect(collapsedRoot.querySelector(".brand-name")).toBeNull();
    expect(collapsedRoot.querySelector(".brand-mark, .brand-logo")).toBeNull();
    expect(collapsedRoot.querySelector(".rail-toggle")?.getAttribute("aria-label")).toBe(labels.expandRail);
    const rows = [...collapsedRoot.querySelectorAll<HTMLElement>(".rail-row")];
    expect(rows).toHaveLength(apps.length);
    rows.forEach((row, index) => {
      expect(row.getAttribute("aria-label")).toBe(apps[index].label);
      expect(row.getAttribute("title")).toBe(apps[index].label);
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

  it("switches theme and language through the host's preferences, and signs out once through the account", async () => {
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
    });
    const rows = [...root.querySelectorAll<HTMLButtonElement>(".menu-row")];
    rows.find((row) => row.textContent?.includes("Light"))?.click();
    expect(setTheme).toHaveBeenCalledWith("light");
    rows[0].click();
    expect(setLocale).toHaveBeenCalledWith("en");
    rows.at(-1)?.click();
    // Exactly one sign-out: the account owns it, the menu does not also report one of its own.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
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
  /* The application is one surface on the rail's ground: it fills the rest of the page and only its left corners round. */
  it("puts the application on the rail as one surface and draws no column of its own", async () => {
    const root = await mount(
      PlatformShell,
      { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false },
      { panel: () => h("div", { class: "panel-slot" }), default: () => h("div", { class: "workspace-slot" }) },
    );
    const app = root.querySelector(".platform-app");
    expect(app).not.toBeNull();
    // Whatever the page contributes sits inside the surface, beside the rail — never as a shell-drawn column.
    expect(app?.querySelector(".panel-slot")).not.toBeNull();
    expect(app?.querySelector(".workspace-slot")).not.toBeNull();
    expect(app?.querySelector(".app-panel")).toBeNull();
  });

  it("starts collapsed unless the reader expanded it", async () => {
    const fresh = await mount(PlatformShell, { apps, activeAppId: "agents", account, preferences: preferences(), labels }, { default: () => h("div") });
    // The rail is collapsed on a fresh load, whatever the screen width: the applications open full page.
    expect(fresh.querySelector(".platform-shell")?.classList.contains("rail-collapsed")).toBe(true);
    app?.unmount();

    localStorage.setItem("ontomato.platform.railCollapsed", "false");
    const remembered = await mount(PlatformShell, { apps, activeAppId: "agents", account, preferences: preferences(), labels }, { default: () => h("div") });
    expect(remembered.querySelector(".platform-shell")?.classList.contains("rail-collapsed")).toBe(false);
  });

  it("lets a controlled value win over the stored one", async () => {
    localStorage.setItem("ontomato.platform.railCollapsed", "true");
    const root = await mount(
      PlatformShell,
      { apps, activeAppId: "agents", account, preferences: preferences(), labels, collapsed: false },
      { default: () => h("div") },
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
      { default: () => h("div") },
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
});
