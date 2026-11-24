import { definePanel } from "@ontomato/contracts/panel-manifest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
import { panelStateKey } from "../personal-state-key";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  lockProducts: vi.fn(async () => undefined),
  requireRegisteredPanelRoot: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));

vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (action: (client: { query: typeof mocks.query }) => unknown) => action({ query: mocks.query }),
}));

vi.mock("../../../infrastructure/product-write-lock", () => ({
  lockProducts: mocks.lockProducts,
}));

vi.mock("../member-path", async importOriginal => {
  const actual = await importOriginal<typeof import("../member-path")>();
  return {
    ...actual,
    requireRegisteredPanelRoot: mocks.requireRegisteredPanelRoot,
  };
});

import { readPanelPersonalState, writePanelPersonalState } from "../personal-state";

const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "token-1", locale: "en" };

const panel = {
  id: "panel-personal",
  domainId: "domain-1",
  ownerId: "user-1",
  revision: 1,
  name: "Personal panel",
  description: "",
  visibility: "domain" as const,
  editable: true,
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
  content: { html: "<main></main>", module: "" },
  manifest: definePanel({
    state: {
      term: { type: { kind: "scalar", type: "string" }, external: true, personal: true, deepLink: false, default: "autumn" },
      density: { type: { kind: "scalar", type: "string" }, personal: true, deepLink: false, default: "compact" },
    },
    members: {},
  }),
};

const source = {
  kind: "registered" as const,
  applicationId: "app-1",
  useId: "use-1",
};

describe("panel personal state service", () => {
  let preferences: Map<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    preferences = new Map([
      [panelStateKey(owner.domainId, panel.id, [], panel.id, "term"), "summer"],
      [panelStateKey(owner.domainId, panel.id, [], panel.id, "density"), "comfortable"],
    ]);
    mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith("SELECT key,value FROM user_preferences")) {
        const keys = args[1] as string[];
        return {
          rows: keys.filter(key => preferences.has(key)).map(key => ({ key, value: preferences.get(key) })),
        };
      }
      if (sql.startsWith("INSERT INTO user_preferences")) {
        const keys = args[1] as string[];
        const encoded = args[2] as string[];
        for (let i = 0; i < keys.length; i++) {
          preferences.set(keys[i]!, JSON.parse(encoded[i]!));
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    mocks.requireRegisteredPanelRoot.mockResolvedValue({
      panel,
      entry: {
        id: "use-1",
        pageKey: "page-1",
        panelId: panel.id,
        path: "/applications/app-1/page-1",
        access: { kind: "domain-member" as const },
        inputs: { term: { frameState: "term" } },
      },
      framePanelId: undefined,
    });
  });

  it("rejects controlled fields with 400 PANEL_STATE_CONTROLLED while reading and writing sibling personal fields", async () => {
    await expect(readPanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      fields: ["term", "density"],
    })).rejects.toMatchObject({
      status: 400,
      code: "PANEL_STATE_CONTROLLED",
    } satisfies Partial<HttpError>);

    await expect(writePanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      values: { term: "winter" },
    })).rejects.toMatchObject({
      status: 400,
      code: "PANEL_STATE_CONTROLLED",
    } satisfies Partial<HttpError>);

    await expect(readPanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      fields: ["density"],
    })).resolves.toEqual({
      values: { density: "comfortable" },
    });

    await expect(writePanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      values: { density: "spacious" },
    })).resolves.toEqual({
      values: { density: "spacious" },
    });

    await expect(readPanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      fields: ["density"],
    })).resolves.toEqual({
      values: { density: "spacious" },
    });

    expect(preferences.get(panelStateKey(owner.domainId, panel.id, [], panel.id, "term"))).toBe("summer");
  });

  it("allows reading all personal fields when the entry has no wired inputs", async () => {
    mocks.requireRegisteredPanelRoot.mockResolvedValue({
      panel,
      entry: {
        id: "use-2",
        pageKey: "page-2",
        panelId: panel.id,
        path: "/applications/app-1/page-2",
        access: { kind: "domain-member" as const },
      },
      framePanelId: undefined,
    });

    await expect(readPanelPersonalState(owner, viewer, {
      source,
      memberPath: [],
      fields: ["term", "density"],
    })).resolves.toEqual({
      values: { term: "summer", density: "comfortable" },
    });
  });
});
