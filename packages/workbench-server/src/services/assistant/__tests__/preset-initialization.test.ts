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

it("moves only the pending preset publication and startup does not restore withdrawn access", async () => {
  const domains = new Map([
    ["pending", new Map([["regular", "legacy-id"]])],
    ["already-published", new Map([["regular", "withdrawn-id"]])],
  ]);
  const publications = new Set(["already-published"]);
  const granted = new Set<string>();
  mocks.get.mockResolvedValue({ text: JSON.stringify([...domains.keys()]) });
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });

  mocks.transaction.mockImplementation(async callback => {
    const staged = new Map([...domains].map(([domain, agents]) => [domain, new Map(agents)]));
    const markers = new Set(publications);
    const query = async (sql: string, params: string[]) => {
      const [first, second, kind] = params;
      if (sql.includes("INSERT INTO assistant_agents")) {
        const agents = staged.get(second)!;
        if (agents.has(kind)) return { rows: [] };
        agents.set(kind, first);
        return { rows: [{ id: first }] };
      }
      if (sql.includes("INSERT INTO assistant_preset_upgrades")) {
        expect(params).toEqual([first, "preset-object-policy", 1]);
        if (markers.has(first)) return { rowCount: 0 };
        markers.add(first);
        return { rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM assistant_agents")) {
        return { rows: [...staged.get(first)!.values()].map(id => ({ id })) };
      }
      return { rows: [] };
    };
    await callback({ query });
    for (const [domain, agents] of staged) domains.set(domain, agents);
    for (const domain of markers) publications.add(domain);
  });

  const failure = new Error("Policy write failed");
  mocks.post.mockRejectedValueOnce(failure).mockImplementation(async (_name, _url, body) => {
    for (const id of body.createdIds) granted.add(id);
  });
  await expect(initializeDomainPresetAgents("pending")).rejects.toBe(failure);
  expect(publications.has("pending")).toBe(false);
  expect([...domains.get("pending")!.values()]).toEqual(["legacy-id"]);

  await initializeExistingDomainPresetAgents();
  const { ids, createdIds } = mocks.post.mock.calls[1][2];
  expect(ids).toContain("legacy-id");
  expect(createdIds).toEqual(ids.filter((id: string) => id !== "legacy-id"));
  expect(granted.size).toBeGreaterThan(0);
  const revoked = createdIds[0];
  granted.delete(revoked);

  await initializeExistingDomainPresetAgents();
  expect(mocks.post.mock.calls.map(([, , body]) => body.domainId)).toEqual(["pending", "pending"]);
  expect(granted.has(revoked)).toBe(false);
  expect(granted.has("withdrawn-id")).toBe(false);
});
