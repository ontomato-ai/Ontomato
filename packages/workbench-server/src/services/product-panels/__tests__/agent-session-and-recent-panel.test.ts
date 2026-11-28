import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_SESSION, FAVORITE, RECENT_VISIT, RENAME_AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import type { AgentHostRunStatus } from "@ontomato/contracts/agent-host";
import { assistantStore } from "../../assistant/store";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost, PanelRecordTarget } from "../server-operations";

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ sessionId: string; agentId: string; agentName: string; title: string; updatedAt: string }>,
  runs: new Map<string, AgentHostRunStatus>(),
  favoriteKeys: new Set<string>(),
  visits: [] as Array<{ appId: string; title: string; path: string; context?: string; visitedAt: string }>,
  catalog: [] as Array<{ id: string; names: Record<string, string>; icon: string }>,
}));

vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    async sessionStatuses(ids: string[]) {
      return ids.map(id => ({ session: { id }, latestRun: state.runs.get(id) ?? null }));
    }
  },
}));

vi.mock("../../assistant/store", () => ({
  assistantStore: {
    listSessions: vi.fn(async (_owner, opts?: { search?: string; limit?: number }) => {
      const q = opts?.search?.trim().toLowerCase() ?? "";
      return state.sessions
        .filter(item => !q || item.title.toLowerCase().includes(q) || item.agentName.toLowerCase().includes(q))
        .slice(0, opts?.limit ?? 20)
        .map(item => ({
          ...item,
          id: item.sessionId,
          agent_id: item.agentId,
          agentKind: "regular",
          workspace_id: null,
          origin: "user",
          updated_at: new Date(item.updatedAt),
          created_at: new Date(item.updatedAt),
          cursorUpdatedAt: item.updatedAt.replace(".000Z", ".000123Z"),
        }));
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

import {
  agentSessionServerOperations,
  cleanSessionDisplayTitle,
  createAgentSessionReadAdapter,
  formatShortDateTime,
} from "../agent-session-panel";
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
  state.runs = new Map([[state.sessions[0]!.sessionId, {
    id: "33333333-3333-4333-8333-333333333333", status: "running", stopReason: null,
  }]]);
  state.favoriteKeys = new Set([JSON.stringify([AGENT_SESSION, "11111111-1111-4111-8111-111111111111"])]);
  state.visits = [
    { appId: "dashboards", title: "Sales Board", path: "/dashboards?dashboardId=b1", visitedAt: "2026-11-25T01:00:00.000Z" },
    { appId: "browser", title: "Order Detail", path: "/browser/views/Order?key=ORD-42", visitedAt: "2026-11-25T02:30:00.000Z" },
    { appId: "hidden-app", title: "Hidden", path: "/hidden", visitedAt: "2026-11-25T00:00:00.000Z" },
  ];
  state.catalog = [
    { id: "dashboards", names: { en: "Dashboards" }, icon: "layout-dashboard" },
    { id: "browser", names: { en: "Object Browser" }, icon: "objects" },
  ];
});

describe("platform:AgentSession and platform:RecentVisit panel reads and rename", () => {
  it("cleans legacy session titles, derives favorited from platform-home, formats subtitle time, and renames sessions", async () => {
    expect(cleanSessionDisplayTitle('{"resource":{"title":"Faculty Scale"}}', "Untitled")).toBe("Faculty Scale");
    const adapter = createAgentSessionReadAdapter(owner, viewer);
    const rows = await adapter.list({});
    const expectedSessionTime = formatShortDateTime("2026-11-25T01:00:00.000Z", "en");
    expect(rows).toMatchObject([
      {
        className: AGENT_SESSION,
        primaryKey: "11111111-1111-4111-8111-111111111111",
        label: "Quarterly Revenue",
        subtitle: `Analyst · ${expectedSessionTime}`,
        fields: { running: true, runningStatus: "Running" },
        tones: { runningStatus: "info" },
        outputs: {
          openPath: "/agents/chat?agentId=22222222-2222-4222-8222-222222222222&sessionId=11111111-1111-4111-8111-111111111111",
          favorited: true,
        },
      },
    ]);

    expect((await adapter.record(rows[0]!.primaryKey)).fields.running).toBe(true);

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

  it("publishes the latest run outcome and passes an exact page boundary back to the store", async () => {
    const [first] = state.sessions;
    const others = ["completed", "failed", "cancelled", "pending", "lookahead"].map((_status, index) => ({
      ...first!,
      sessionId: `11111111-1111-4111-8111-11111111111${index + 2}`,
    }));
    state.sessions.push(...others);
    const run = state.runs.get(first!.sessionId)!;
    state.runs.set(first!.sessionId, { ...run, status: "stopped", stopReason: "stop", delegatedRunning: true });
    for (const [index, stopReason] of (["stop", "length", "aborted"] as const).entries()) {
      state.runs.set(others[index]!.sessionId, { ...run, status: "stopped", stopReason });
    }
    const adapter = createAgentSessionReadAdapter(owner, viewer);
    const filters = { agentIds: [first!.agentId], agentKinds: ["regular"], workspaceId: "none", search: "Analyst", limit: 5 };
    const page = await adapter.tasks(filters);
    expect(page.rows.map(row => row.fields.status)).toEqual(["running", "completed", "failed", "cancelled", "pending"]);
    expect(page.rows[0]).toMatchObject({
      fields: {
        agentId: first!.agentId, agentName: "Analyst", agentKind: "regular", origin: "user",
        createdAt: first!.updatedAt, updatedAt: first!.updatedAt, running: true,
        latestRun: { kind: "json", value: { id: run.id, status: "stopped", stopReason: "stop", delegatedRunning: true } },
      },
    });
    expect(page.rows[0]!.fields).not.toHaveProperty("workspaceId");
    expect(page.hasMore).toBe(true);
    await adapter.tasks({ ...filters, cursor: page.nextCursor });
    expect(assistantStore.listSessions).toHaveBeenLastCalledWith(owner, {
      ...filters, limit: 6, workspaceId: null,
      after: { updatedAt: "2026-11-25T01:00:00.000123Z", id: others[3]!.sessionId },
    });
    expect(() => adapter.tasks({ cursor: "invalid" })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("filters recent visits to currently visible applications and exposes context, formatted time, and openPath", async () => {
    const adapter = createRecentVisitReadAdapter(owner, viewer);
    const rows = await adapter.list({ limit: 8 });
    const expectedBoardTime = formatShortDateTime("2026-11-25T01:00:00.000Z", "en");
    const expectedObjectTime = formatShortDateTime("2026-11-25T02:30:00.000Z", "en");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      className: RECENT_VISIT,
      primaryKey: "/dashboards?dashboardId=b1",
      label: "Sales Board",
      subtitle: `Dashboards · ${expectedBoardTime}`,
      fields: { context: "" },
      outputs: { openPath: "/dashboards?dashboardId=b1" },
    });
    expect(rows[1]).toMatchObject({
      className: RECENT_VISIT,
      primaryKey: "/browser/views/Order?key=ORD-42",
      label: "Order Detail",
      subtitle: `Object Browser · ORD-42 · ${expectedObjectTime}`,
      fields: { context: "ORD-42" },
      outputs: { openPath: "/browser/views/Order?key=ORD-42" },
    });
  });
});
