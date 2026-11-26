import { afterEach, expect, it, vi } from "vitest";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import { listCurrentProducts } from "../catalog";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query }),
}));
vi.mock("../../product-governance/grants", async original => ({
  ...await original<typeof import("../../product-governance/grants")>(),
  productDefinitionOwnerHeaders: () => ({}),
}));

afterEach(() => { vi.unstubAllGlobals(); });

const owner = { domainId: "domain-1", userId: "reader" };
const credentials = { token: "reader-token", locale: "en" };
const date = new Date("2026-11-26T00:00:00Z");

it.each(["projection", "panel"] as const)("bounds %s catalogue reads as the candidate set grows past one authorization batch", async kind => {
  // Round 2 #2: a fixed page does not yet bound authorization; the catalogue checks USE and EDIT on all candidates.
  const measure = async (size: number, rpcBudget: number) => {
    const candidates = Array.from({ length: size }, (_, i) => {
      const id = `${kind}-${String(i).padStart(3, "0")}`;
      const shared = { name: id, description: "", visibility: "domain" };
      const definition = kind === "panel"
        ? { ...shared, content: { html: "<main></main>", module: "export default {};" }, manifest: { state: {}, members: {} } }
        : { ...shared, componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {}, data: {} };
      return {
        id, domainId: owner.domainId, ownerId: owner.userId, revision: 1, definition,
        createdAt: date, updatedAt: date, ...shared, sortKey: id,
      } satisfies CurrentProductRow & { name: string; description: string; visibility: string; sortKey: string };
    });
    const rpc = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      if (!url.endsWith("/authorization/objects/decide-batch")) throw new Error(`Unexpected RPC: ${url}`);
      const { requests } = JSON.parse(String(init.body)) as { requests: ObjectDecisionRequest[] };
      return Response.json({ decisions: requests.map(() => ({ allowed: true })) });
    });
    vi.stubGlobal("fetch", rpc);
    query.mockClear().mockImplementation(async (sql: string, params: [string, string[]?, ...unknown[]]) => {
      if (!sql.includes(`"product_${kind}s"`)) throw new Error(`Unexpected query: ${sql}`);
      const ids = params[1];
      const visible = ids ? candidates.filter(candidate => ids.includes(candidate.id)) : candidates;
      if (sql.startsWith("SELECT COUNT(")) return { rows: [{ total: visible.length }] };
      if (/\bLIMIT\b/.test(sql)) return { rows: visible.slice(0, Number(params.at(-2))) };
      return { rows: visible };
    });

    const page = await listCurrentProducts(owner, credentials, kind, { q: "", scope: "all", sort: "name", limit: 20 });

    expect(page.total).toBe(size);
    expect(page.items).toHaveLength(Math.min(size, 20));
    expect(query.mock.calls.length).toBeLessThanOrEqual(3);
    expect(rpc.mock.calls.length).toBeLessThanOrEqual(rpcBudget);
  };

  await measure(25, 1);
  await measure(210, 3);
});
