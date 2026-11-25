import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SESSION, FAVORITE, RECENT_VISIT, RENAME_AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost, PanelRecordTarget } from "../server-operations";

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ sessionId: string; agentId: string; agentName: string; title: string; updatedAt: string }>,
  favoriteKeys: new Set<string>(),
  visits: [] as Array<{ appId: string; title: string; path: string; context?: string; visitedAt: string }>,
  catalog: [] as Array<{ id: string; names: Record<string, string>; icon: string }>,
}));

vi.mock("../../assistant/store", () => ({
  assistantStore: {
    listUserSessions: vi.fn(async (_owner, opts?: { search?: string; limit?: number }) => {
      const q = opts?.search?.trim().toLowerCase() ?? "";
      return state.sessions
        .filter(item => !q || item.title.toLowerCase().includes(q) || item.agentName.toLowerCase().includes(q))
        .slice(0, opts?.limit ?? 20);
    }),
    session: vi.fn(async (id: string) => {
      const found = state.sessions.find(item => item.sessionId === id);
      if (!found) throw new Error("Not found");
      return {
        id: found.sessionId,
        agent_id: found.agentId,
        title: found.title,
        updated_at: new Date(found.updatedAt),
      };
    }),
    renameSession: vi.fn(async (_owner, sessionId: string, title: string) => {
      const found = state.sessions.find(item => item.sessionId === sessionId);
      if (!found) throw new Error("Not found");
      found.title = title;
      return { sessionId, agentId: found.agentId, title, updatedAt: found.updatedAt };
    }),
  },
}));

vi.mock("../../platform-home/service", () => ({
  favoriteTargetKey: (objectType: string, primaryKey: string) => JSON.stringify([objectType, primaryKey]),
  readFavoriteKeySet: vi.fn(async () => new Set(state.favoriteKeys)),
  isFavoriteTarget: vi.fn(async (_owner, objectType: string, primaryKey: string) =>
    state.favoriteKeys.has(JSON.stringify([objectType, primaryKey])),
  ),
}));

vi.mock("../../personal-workspace/store", () => ({
  personalWorkspaceStore: {
    recent: vi.fn(async () => [...state.visits]),
  },
}));

vi.mock("../application-catalogue", () => ({
  applicationCatalogueClient: () => ({
    navigation: vi.fn(async () => state.catalog),
  }),
}));

import { agentSessionServerOperations, cleanSessionDisplayTitle, createAgentSessionReadAdapter } from "../agent-session-panel";
import { createRecentVisitReadAdapter } from "../recent-visit-panel";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "tok", locale: "en" };
const actor = { owner, credentials: viewer };
const host: PanelOperationHost = {
  initiator: actor,
  executor: actor,
  request: vi.fn(),
  requestWorkbench: vi.fn(),
  locale: "en",
};

beforeEach(() => {
  state.sessions = [
    {
      sessionId: "11111111-1111-4111-8111-111111111111",
      agentId: "22222222-2222-4222-8222-222222222222",
      agentName: "Analyst",
      title: 'Analyze metric\n{"resource":{"title":"Quarterly Revenue"}}',
      updatedAt: "2026-11-25T01:00:00.000Z",
    },
  ];
  state.favoriteKeys = new Set([JSON.stringify([AGENT_SESSION, "11111111-1111-4111-8111-111111111111"])]);
  state.visits = [
    { appId: "dashboards", title: "Sales Board", path: "/dashboards?dashboardId=b1", visitedAt: "2026-11-25T01:00:00.000Z" },
    { appId: "hidden-app", title: "Hidden", path: "/hidden", visitedAt: "2026-11-25T00:00:00.000Z" },
  ];
  state.catalog = [
    { id: "dashboards", names: { en: "Dashboards" }, icon: "layout-dashboard" },
  ];
});

describe("platform:AgentSession and platform:RecentVisit panel reads and rename", () => {
  it("cleans legacy session titles, derives favorited from platform-home, and renames sessions", async () => {
    expect(cleanSessionDisplayTitle('{"resource":{"title":"Faculty Scale"}}', "Untitled")).toBe("Faculty Scale");
    const adapter = createAgentSessionReadAdapter(owner, viewer);
    const rows = await adapter.list({});
    expect(rows).toMatchObject([
      {
        className: AGENT_SESSION,
        primaryKey: "11111111-1111-4111-8111-111111111111",
        label: "Quarterly Revenue",
        subtitle: "Analyst",
        outputs: {
          openPath: "/agents/chat?agentId=22222222-2222-4222-8222-222222222222&sessionId=11111111-1111-4111-8111-111111111111",
          favorited: true,
        },
      },
    ]);

    const renameOp = agentSessionServerOperations.find(op => op.handlerRef === RENAME_AGENT_SESSION)!;
    const target: PanelRecordTarget = { kind: "object", objectType: AGENT_SESSION, primaryKey: "11111111-1111-4111-8111-111111111111" };
    const result = await renameOp.execute(host, target as never, { title: "Q4 Board Review" }, "i-1");
    expect(result).toMatchObject({
      kind: "success",
      data: { sessionId: "11111111-1111-4111-8111-111111111111", title: "Q4 Board Review" },
      affected: { objectTypes: [AGENT_SESSION, FAVORITE] },
    });
    expect(state.sessions[0]?.title).toBe("Q4 Board Review");
  });

  it("filters recent visits to currently visible applications and exposes openPath", async () => {
    const adapter = createRecentVisitReadAdapter(owner, viewer);
    const rows = await adapter.list({ limit: 8 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      className: RECENT_VISIT,
      primaryKey: "/dashboards?dashboardId=b1",
      label: "Sales Board",
      subtitle: "Dashboards",
      outputs: { openPath: "/dashboards?dashboardId=b1" },
    });
  });
});
