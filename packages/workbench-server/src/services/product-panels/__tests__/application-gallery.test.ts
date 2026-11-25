import { tmpdir } from "node:os";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeItemRef } from "@ontomato/contracts/platform-home";
import { APPLICATION, AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";

const state = vi.hoisted(() => ({
  favorites: [] as HomeItemRef[],
  catalog: [] as Record<string, unknown>[],
  agents: [] as Array<{ id: string; name: string; description: string; icon: string | null; enabled: boolean }>,
}));

vi.mock("../../platform-home/service", () => ({
  readFavorites: vi.fn(async () => [...state.favorites]),
  addHomeFavorite: vi.fn(async (_owner, item: HomeItemRef) => {
    const key = `${item.kind}:${item.id}`;
    if (!state.favorites.some(existing => `${existing.kind}:${existing.id}` === key)) {
      state.favorites = [...state.favorites, item];
    }
    return { items: [...state.favorites] };
  }),
  removeHomeFavorite: vi.fn(async (_owner, item: HomeItemRef) => {
    const key = `${item.kind}:${item.id}`;
    state.favorites = state.favorites.filter(existing => `${existing.kind}:${existing.id}` !== key);
    return { items: [...state.favorites] };
  }),
  addFavoriteTarget: vi.fn(async (_owner, target: { objectType: string; primaryKey: string }) => {
    const kind = target.objectType === APPLICATION ? "application" : "agent";
    const key = `${kind}:${target.primaryKey}`;
    if (!state.favorites.some(existing => `${existing.kind}:${existing.id}` === key)) {
      state.favorites = [...state.favorites, { kind, id: target.primaryKey }];
    }
  }),
  removeFavoriteTarget: vi.fn(async (_owner, target: { objectType: string; primaryKey: string }) => {
    const kind = target.objectType === APPLICATION ? "application" : "agent";
    const key = `${kind}:${target.primaryKey}`;
    state.favorites = state.favorites.filter(existing => `${existing.kind}:${existing.id}` !== key);
  }),
}));

vi.mock("../../../utils/backend-client", async (actual) => ({
  ...await actual<typeof import("../../../utils/backend-client")>(),
  backendGet: vi.fn(async () => ({
    status: 200,
    text: JSON.stringify({ success: true, data: state.catalog }),
  })),
}));

vi.mock("../../assistant/service", () => ({
  assistantService: {
    agents: vi.fn(async () => ({ agents: state.agents })),
  },
}));

vi.mock("../catalog", () => ({
  listCurrentProducts: vi.fn(async () => ({ items: [] })),
}));

import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost, PanelRecordTarget, SinglePanelOperationOutcome } from "../server-operations";
import { createApplicationReadAdapter } from "../application-catalogue";
import { favoriteServerOperations } from "../favorite-panel";

let createAgentDefinitionDirectory: typeof import("../agent-definition-directory").createAgentDefinitionDirectory;

const owner = { domainId: "domain-a", userId: "reader-1" };
const viewer = { token: "tok", locale: "en" };

beforeAll(async () => {
  installContentLayout({
    runtimeRoot: tmpdir(),
    prompts: [],
    publicSkillsRoot: tmpdir(),
    runtimeResources: [],
  });
  ({ createAgentDefinitionDirectory } = await import("../agent-definition-directory"));
});

beforeEach(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  state.favorites = [
    { kind: "application", id: "dashboards" },
    { kind: "agent", id: "11111111-1111-4111-8111-111111111111" },
  ];
  state.catalog = [
    {
      id: "home",
      kind: "native",
      rail: "top",
      category: "business",
      sort: 0,
      entry: { path: "/home", renderer: "home", home: "/home" },
      entryAccess: ["domain-member"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Personal workspace" },
      descriptions: { en: "Home" },
      icon: "home",
    },
    {
      id: "application-gallery",
      kind: "native",
      rail: "top",
      category: "business",
      sort: 2,
      entry: { path: "/applications", renderer: "application-gallery", home: "/applications" },
      entryAccess: ["domain-member"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Application gallery" },
      descriptions: { en: "Gallery" },
      icon: "gallery",
    },
    {
      id: "settings",
      kind: "native",
      rail: "bottom",
      category: "admin",
      sort: 20,
      entry: { path: "/settings", renderer: "settings" },
      entryAccess: ["system-config"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Settings" },
      descriptions: { en: "System settings" },
      icon: "settings",
    },
    {
      id: "dashboards",
      kind: "native",
      rail: "top",
      category: "business",
      sort: 20,
      entry: { path: "/dashboards", renderer: "dashboards", home: "/dashboards" },
      entryAccess: ["domain-member"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Dashboards" },
      descriptions: { en: "Charts and metrics" },
      icon: "dashboards",
    },
    {
      id: "data-governance",
      kind: "link",
      rail: "apps",
      category: "admin",
      sort: 40,
      entry: { path: "/__external/data-governance", renderer: "data-governance" },
      entryAccess: ["data-governance"],
      scheduleAdapter: null,
      releaseId: null,
      names: { en: "Data governance" },
      descriptions: { en: "External platform" },
      icon: "governance",
    },
  ];
  state.agents = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Analyst",
      description: "Data analysis helper",
      icon: "sparkles",
      enabled: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Disabled bot",
      description: "Should stay hidden",
      icon: null,
      enabled: false,
    },
  ];
});

describe("application gallery real-object reads and favorite operations", () => {
  it("lists visible applications in rail order with real identities, openPath outputs, category and search filters", async () => {
    const adapter = createApplicationReadAdapter(owner, viewer);
    const all = await adapter.available({ category: "all" });
    expect(all.map(row => ({
      id: row.primaryKey,
      className: row.className,
      favorite: row.fields.favorite,
      openPath: row.outputs?.openPath,
    }))).toEqual([
      { id: "dashboards", className: APPLICATION, favorite: true, openPath: "/dashboards" },
      { id: "data-governance", className: APPLICATION, favorite: false, openPath: "/__external/data-governance" },
      { id: "settings", className: APPLICATION, favorite: false, openPath: "/settings" },
    ]);

    expect((await adapter.available({ category: "agents" }))).toEqual([]);
    expect((await adapter.available({ category: "admin" })).map(row => row.primaryKey)).toEqual([
      "data-governance",
      "settings",
    ]);
    expect((await adapter.available({ search: "metrics" })).map(row => row.primaryKey)).toEqual(["dashboards"]);
    expect((await adapter.available({ favoritesOnly: true })).map(row => row.primaryKey)).toEqual(["dashboards"]);
  });

  it("lists enabled agents with real AgentDefinition identities and openPath outputs", async () => {
    const directory = createAgentDefinitionDirectory(owner, viewer);
    const rows = await directory.available({});
    expect(rows).toEqual([{
      primaryKey: "11111111-1111-4111-8111-111111111111",
      className: AGENT_DEFINITION,
      label: "Analyst",
      subtitle: "Data analysis helper",
      fields: { category: "agents", icon: "sparkles", favorite: true },
      outputs: { openPath: "/agents/chat?agentId=11111111-1111-4111-8111-111111111111" },
    }]);
    expect(await directory.available({ search: "nonexistent" })).toEqual([]);
  });

  it("pins and unpins applications and agents idempotently and refuses unavailable targets", async () => {
    type TargetedAction = {
      execute(host: PanelOperationHost, target: PanelRecordTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome>;
    };
    const favOp = favoriteServerOperations.find(op => op.handlerRef === "favorites.add") as unknown as TargetedAction;
    const unfavOp = favoriteServerOperations.find(op => op.handlerRef === "favorites.remove") as unknown as TargetedAction;
    const host = {
      initiator: { owner, credentials: viewer },
      executor: { owner, credentials: viewer },
      locale: "en",
      requestWorkbench: vi.fn(),
      request: vi.fn(),
    };
    const appTarget = (primaryKey: string): PanelRecordTarget => ({ kind: "object", objectType: APPLICATION, primaryKey });
    const agentTarget = (primaryKey: string): PanelRecordTarget => ({ kind: "object", objectType: AGENT_DEFINITION, primaryKey });

    const pinned = await favOp.execute(host, appTarget("settings"), {}, "i-1");
    expect(pinned.kind).toBe("success");
    expect(state.favorites.some(item => item.kind === "application" && item.id === "settings")).toBe(true);

    const refusedHidden = await favOp.execute(host, appTarget("secret-app"), {}, "i-2");
    expect(refusedHidden.kind).toBe("refusal");

    const unpinned = await unfavOp.execute(host, appTarget("settings"), {}, "i-3");
    expect(unpinned.kind).toBe("success");
    expect(state.favorites.some(item => item.kind === "application" && item.id === "settings")).toBe(false);

    const refusedDisabled = await favOp.execute(host, agentTarget("22222222-2222-4222-8222-222222222222"), {}, "i-4");
    expect(refusedDisabled.kind).toBe("refusal");

    const unpinnedAgent = await unfavOp.execute(host, agentTarget("11111111-1111-4111-8111-111111111111"), {}, "i-5");
    expect(unpinnedAgent.kind).toBe("success");
    expect(state.favorites.some(item => item.kind === "agent")).toBe(false);
  });
});
