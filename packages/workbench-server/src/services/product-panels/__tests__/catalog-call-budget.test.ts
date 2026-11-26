import { afterEach, expect, it, vi } from "vitest";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import { listCurrentProducts } from "../catalog";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query }),
}));
vi.mock("../../product-governance/service-authentication", async original => ({
  ...await original<typeof import("../../product-governance/service-authentication")>(),
  productDefinitionOwnerHeaders: () => ({}),
}));

afterEach(() => { vi.unstubAllGlobals(); });

const owner = { domainId: "domain-1", userId: "reader" };
const credentials = { token: "reader-token", locale: "en" };
const date = new Date("2026-11-26T00:00:00Z");

it.each(["projection", "panel"] as const)("reads a fixed %s page with one range and no candidate IDs as the catalogue grows", async kind => {
  for (const size of [25, 210, 450]) {
    const candidates = Array.from({ length: size }, (_, i) => {
      const fixed = i % 2 === 0;
      const id = `${fixed ? "builtin-product-" : ""}${kind}-${String(i).padStart(3, "0")}`;
      const shared = { name: id, description: "", visibility: fixed ? "platform" : "domain" };
      const definition = kind === "panel"
        ? { ...shared, content: { html: "<main></main>", module: "export default {};" }, manifest: { state: {}, members: {} } }
        : { ...shared, componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {}, data: {} };
      return {
        id, domainId: fixed ? null : owner.domainId, ownerId: fixed ? null : owner.userId, revision: 1, definition,
        createdAt: date, updatedAt: date, ...shared, sortKey: id, editable: !fixed,
      } satisfies CurrentProductRow & { name: string; description: string; visibility: string; sortKey: string; editable: boolean };
    });
    const rpc = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(url).toMatch(/\/authorization\/objects\/read-ranges$/);
      expect(JSON.parse(String(init.body))).toEqual({ kind: kind.toUpperCase(), verbs: ["USE", "EDIT"] });
      const scope = { authorId: owner.userId, objectIds: [], all: false };
      return Response.json({ ranges: { USE: { ...scope, fixed: true }, EDIT: { ...scope, fixed: false } } });
    });
    vi.stubGlobal("fetch", rpc);
    query.mockClear().mockImplementation(async (sql: string, params: unknown[]) => {
      if (!sql.includes(`"product_${kind}s"`)) throw new Error(`Unexpected query: ${sql}`);
      if (sql.startsWith("SELECT COUNT(")) return { rows: [{ total: candidates.length }] };
      if (/\bLIMIT\b/.test(sql)) return { rows: candidates.slice(0, Number(params.at(-2))) };
      throw new Error(`Unexpected catalogue read: ${sql}`);
    });

    const page = await listCurrentProducts(owner, credentials, kind, { q: "", scope: "all", sort: "name", limit: 20 });

    expect(page.total).toBe(size);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(1);
  }
});
