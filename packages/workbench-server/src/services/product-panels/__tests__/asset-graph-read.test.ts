import { beforeAll, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { CurrentProductRow } from "../../../infrastructure/product-current";

const { readAccessibleCurrentDefinitions } = vi.hoisted(() => ({ readAccessibleCurrentDefinitions: vi.fn() }));
vi.mock("../current", () => ({ readAccessibleCurrentDefinitions }));
vi.mock("../application-catalogue", () => ({
  applicationCatalogueClient: () => ({ query: async () => ({ rows: [] }) }),
}));
vi.mock("../../assistant/store", () => ({ assistantStore: { agents: async () => [] } }));
vi.mock("../object-detail", () => ({ listObjectDetailPanelMappings: async () => [] }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({}) }));
vi.mock("../../../utils/backend-client", async original => ({
  ...await original<typeof import("../../../utils/backend-client")>(),
  backendPost: async () => ({ text: JSON.stringify({ data: { classDef: [] } }) }),
}));

import { readProductAssetGraph } from "../asset-graph-read";

beforeAll(() => configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
}));

it("returns the business graph when another readable projection has a retired owner read", async () => {
  const owner = { domainId: "test-domain", userId: "test-author" };
  const now = new Date("2026-11-26");
  const rows = { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} };
  const projection: CurrentProductRow = {
    id: "orders",
    domainId: owner.domainId,
    ownerId: owner.userId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    definition: {
      visibility: "domain", name: "Orders", description: "", componentId: "@ontomato/sdk:ObjectList",
      inputs: {}, outputs: {}, config: {},
      data: { rows },
    },
  };
  const obsolete: CurrentProductRow = {
    ...projection,
    id: "obsolete",
    definition: {
      ...projection.definition,
      data: {
        rows,
        grants: { source: { type: { kind: "PlatformObjectType", id: "platform:Application" } }, read: "grants", params: {} },
      },
    },
  };
  readAccessibleCurrentDefinitions.mockImplementation(async (_owner, _viewer, kind) =>
    kind === "projection" ? [projection, obsolete] : []);

  const { graph } = await readProductAssetGraph(owner, { token: "caller", locale: "en" });

  expect(graph.edges).toContainEqual({ source: "asset:orders", target: "object-type:Order", relation: "renders", storage: "ontology" });
  expect(graph.nodes.some(({ id }) => id === "asset:obsolete")).toBe(false);
});
