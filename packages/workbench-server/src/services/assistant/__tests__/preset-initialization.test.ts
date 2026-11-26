import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "service-token" }) },
}));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({ transaction: mocks.transaction }));
vi.mock("../../../infrastructure/product-current", () => ({ findCurrentProduct: async () => null }));
vi.mock("../../product-panels/skill-provider", () => ({ readPanelSkillSources: vi.fn() }));
vi.mock("../../../utils/backend-client", () => ({ backendGet: mocks.get, backendPost: mocks.post }));

import { initializeDomainPresetAgents, initializeExistingDomainPresetAgents } from "../preset-initialization";

it("publishes only newly inserted presets and never restores withdrawn access on startup", async () => {
  const domains = new Map([
    ["pending", new Map([["regular", "legacy-id"]])],
    ["already-published", new Map([["regular", "withdrawn-id"]])],
  ]);
  const granted = new Set<string>();
  mocks.get.mockResolvedValue({ text: JSON.stringify([...domains.keys()]) });
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

  mocks.transaction.mockImplementation(async callback => {
    const staged = new Map([...domains].map(([domain, agents]) => [domain, new Map(agents)]));
    const query = async (sql: string, params: string[]) => {
      const [first, second, kind] = params;
      if (sql.includes("INSERT INTO assistant_agents")) {
        const agents = staged.get(second)!;
        if (agents.has(kind)) return { rows: [] };
        agents.set(kind, first);
        return { rows: [{ id: first }] };
      }
      expect(sql).not.toContain("assistant_preset_upgrades");
      return { rows: [] };
    };
    await callback({ query });
    for (const [domain, agents] of staged) domains.set(domain, agents);
  });

  const failure = new Error("Policy write failed");
  mocks.post.mockRejectedValueOnce(failure).mockImplementation(async (_name, _url, body) => {
    for (const id of body.ids) granted.add(id);
  });
  await expect(initializeDomainPresetAgents("pending")).rejects.toBe(failure);
  expect([...domains.get("pending")!.values()]).toEqual(["legacy-id"]);

  await initializeExistingDomainPresetAgents();
  const ids = [...domains.get("pending")!.values()].filter(id => id !== "legacy-id");
  expect(ids).toHaveLength(4);
  expect(mocks.post.mock.calls[1][2]).toEqual({ domainId: "pending", ids });
  const upgradeIds = [...domains.get("already-published")!.values()].filter(id => id !== "withdrawn-id");
  expect(upgradeIds).toHaveLength(4);
  expect(mocks.post.mock.calls[2][2]).toEqual({ domainId: "already-published", ids: upgradeIds });
  const revoked = ids[0];
  expect(granted.has(revoked)).toBe(true);
  granted.delete(revoked);

  await initializeExistingDomainPresetAgents();
  expect(mocks.post.mock.calls.map(([, , body]) => body.domainId)).toEqual(["pending", "pending", "already-published"]);
  expect(granted.has(revoked)).toBe(false);
  expect(granted.has("withdrawn-id")).toBe(false);
});
