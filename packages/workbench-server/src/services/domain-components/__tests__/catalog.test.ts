import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerDomainComponentRequestSchema, updateDomainComponentRequestSchema, type DomainComponentInput,
} from "@ontomato/contracts/domain-components";
import { HttpError } from "../../../utils/errors";
import { checkDomainComponentSource, registerDomainComponent, updateDomainComponent } from "../catalog";
import { domainComponentRecord, listVisibleDomainComponents } from "../store";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requireObject: vi.fn(),
  writeFirstPublication: vi.fn(),
  decideObjects: vi.fn(),
}));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (table: string) => table,
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }),
}));
vi.mock("../../../infrastructure/product-write-lock", () => ({ lockProducts: async () => {} }));
vi.mock("../../product-panels/component-users", () => ({ findComponentUsers: vi.fn(), declarationChanges: vi.fn() }));
vi.mock("../../product-governance/authorization", () => ({
  requireObject: mocks.requireObject,
  writeFirstPublication: mocks.writeFirstPublication,
  decideObjects: mocks.decideObjects,
  requireAllowed: (decision: { allowed: boolean }) => {
    if (!decision.allowed) throw new Error("USE denied");
  },
}));

function componentInput(module: string): DomainComponentInput {
  return {
    name: "OrderBadge",
    declaration: {
      componentId: "domain-component:00000000-0000-0000-0000-000000000001",
      role: "presentation",
      meaning: "Shows order status",
      data: {},
      config: [],
      inputs: {},
      outputs: {},
      operations: [],
      ports: { props: [], events: [], slots: [] },
    },
    source: {
      template: "<sdk-button>{{ label }}</sdk-button>",
      module,
    },
  };
}

describe("checkDomainComponentSource", () => {
  it("allows @ontomato/sdk/ui, @ontomato/sdk/chart, and vue imports with a default export", async () => {
    const source = [
      'import { computed } from "vue";',
      'import { SdkButton } from "@ontomato/sdk/ui";',
      'import { EChart } from "@ontomato/sdk/chart";',
      'export default { components: { SdkButton, EChart }, setup() { return { label: computed(() => "ok") }; } };',
    ].join("\n");

    await expect(checkDomainComponentSource(componentInput(source))).resolves.toBeUndefined();
  });

  it("rejects illegal third-party package imports including element-plus, lodash, and bare echarts", async () => {
    await expect(checkDomainComponentSource(componentInput(
      'import { ElButton } from "element-plus"; export default { components: { ElButton } };',
    ))).rejects.toThrow(HttpError);

    await expect(checkDomainComponentSource(componentInput(
      'import { ElButton } from "element-plus"; export default { components: { ElButton } };',
    ))).rejects.toThrow(/@ontomato\/sdk\/ui/u);

    await expect(checkDomainComponentSource(componentInput(
      'import { chunk } from "lodash"; export default { setup() { return { chunk }; } };',
    ))).rejects.toThrow(/outside the official SDK entries/u);

    await expect(checkDomainComponentSource(componentInput(
      'import * as echarts from "echarts"; export default { setup() { return { echarts }; } };',
    ))).rejects.toThrow(/@ontomato\/sdk\/chart/u);
  });

  it("rejects direct business API calls and hardcoded /api/ paths with projection/operation guidance", async () => {
    const cases = [
      'export default { async setup() { await fetch("https://example.com/x"); return {}; } };',
      'export default { setup() { const xhr = new XMLHttpRequest(); return { xhr }; } };',
      'export default { setup() { const es = new EventSource("https://example.com/s"); return { es }; } };',
      'export default { setup() { const ws = new WebSocket("wss://example.com/w"); return { ws }; } };',
      'export default { setup() { const endpoint = "/api/orders"; return { endpoint }; } };',
      "export default { setup() { const endpoint = '/api/orders'; return { endpoint }; } };",
      'export default { setup() { const endpoint = `/api/orders/${1}`; return { endpoint }; } };',
    ];

    for (const source of cases) {
      await expect(checkDomainComponentSource(componentInput(source)))
        .rejects.toThrow(/declared projection.*registered operation/u);
    }
  });

  it("allows comments and safe identifiers that resemble network API names", async () => {
    const source = [
      '// Do not call fetch("/api/orders") or new XMLHttpRequest() here',
      '/* EventSource / WebSocket / "/api/internal" in block comment */',
      'import { SdkTag } from "@ontomato/sdk/ui";',
      'const prefetchData = true;',
      'const fetchCount = 2;',
      'const label = "fetch status from projection";',
      'export default { components: { SdkTag }, setup() { return { prefetchData, fetchCount, label }; } };',
    ].join("\n");

    await expect(checkDomainComponentSource(componentInput(source))).resolves.toBeUndefined();
  });
});

describe("domain component authorization", () => {
  const owner = { domainId: "d", userId: "author" };
  const credentials = { token: "viewer-token" };
  const definition = componentInput("export default {}");
  const id = definition.declaration.componentId;
  const row = {
    id, domainId: owner.domainId, ownerId: owner.userId, definition, revision: 1,
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(() => { vi.resetAllMocks(); });

  it("checks CREATE and assigns the selected publication access only on registration", async () => {
    const publicationAccess = { kind: "policy" as const, policyId: "policy" };
    const createRequest = registerDomainComponentRequestSchema.parse({ ...definition, publicationAccess });
    let stored: unknown;
    mocks.query.mockImplementation(async (sql, parameters) => {
      if (sql.startsWith("SELECT id FROM")) return { rows: [] };
      if (sql.startsWith("INSERT")) {
        stored = JSON.parse(parameters[3]);
        return { rows: [row] };
      }
      if (sql.startsWith("SELECT")) return { rows: [row] };
      if (sql.startsWith("UPDATE")) return { rows: [{ ...row, revision: 2 }] };
      throw new Error(sql);
    });

    await expect(registerDomainComponent(owner, credentials, createRequest)).resolves.toMatchObject({ revision: 1 });
    expect(mocks.requireObject).toHaveBeenCalledWith({ create: "COMPONENT" }, credentials);
    expect(stored).not.toHaveProperty("publicationAccess");
    expect(mocks.writeFirstPublication).toHaveBeenCalledWith({
      target: { domainId: owner.domainId, kind: "COMPONENT", id },
      ownerFacts: { ownerId: owner.userId, state: "DRAFT" },
    }, publicationAccess, credentials);

    mocks.writeFirstPublication.mockClear();
    const update = updateDomainComponentRequestSchema.parse({ ...definition, name: "Renamed", revision: 1 });
    await expect(updateDomainComponent(owner, credentials, id, update)).resolves.toMatchObject({ revision: 2 });
    expect(mocks.requireObject).toHaveBeenCalledWith({
      target: { domainId: owner.domainId, kind: "COMPONENT", id },
      ownerFacts: { ownerId: owner.userId, state: "PUBLISHED" }, verb: "EDIT",
    }, credentials);
    expect(mocks.writeFirstPublication).not.toHaveBeenCalled();
  });

  it("uses USE to filter the list and preserves a missing author on legacy records", async () => {
    const missingAuthor = { ...row, ownerId: null, definition: { ...definition, visibility: "private" } };
    const deniedId = "domain-component:00000000-0000-0000-0000-000000000002";
    const legacyShared = { ...row, id: deniedId, definition: {
      ...definition, declaration: { ...definition.declaration, componentId: deniedId }, visibility: "domain",
    } };
    mocks.query.mockResolvedValue({ rows: [missingAuthor, legacyShared] });
    mocks.decideObjects.mockResolvedValue([
      { allowed: true }, { allowed: false }, { allowed: true }, { allowed: true },
    ]);
    expect(domainComponentRecord(missingAuthor, false)).toMatchObject({ ownerId: null });
    const list = await listVisibleDomainComponents(owner.domainId, credentials);
    expect(list.map(item => item.declaration.componentId)).toEqual([id]);
    expect(list[0]).toMatchObject({ editable: true });
    expect(list[0]).not.toHaveProperty("source");
  });
});
