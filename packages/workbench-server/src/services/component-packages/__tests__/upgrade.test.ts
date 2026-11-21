import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentPackageComponent, ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { productReferenceKey } from "../../product-panels/references";
import { checkComponentPackageUpgrade } from "../upgrade";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), findProjectionPanelUsers: vi.fn(), grantedProductIds: vi.fn(),
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (read: (client: { query: typeof mocks.query }) => unknown) => read({ query: mocks.query }),
}));
vi.mock("../../product-panels/references", async (original) => ({
  ...await original<typeof import("../../product-panels/references")>(),
  findProjectionPanelUsers: mocks.findProjectionPanelUsers,
}));
vi.mock("../../product-governance/grants", () => ({ grantedProductIds: mocks.grantedProductIds }));

const name = "@example/upgrade";
const value = { kind: "scalar", type: "string" } as const;
const component: ComponentPackageComponent = {
  componentId: name + ":Example", module: name, exportName: "Example", role: "presentation", meaning: "Example",
  data: {}, inputs: { value }, ports: { props: [], events: [], slots: [] },
};
const previous: ComponentPackageResponse = {
  name, version: "1.0.0", author: "Example", digest: "a".repeat(64), artifactRoot: "/release/one/",
  entries: { [name]: "entry.js" }, components: [component],
};
const candidate: ComponentPackageResponse = { ...previous, version: "2.0.0", digest: "b".repeat(64), artifactRoot: "/release/two/",
  components: [{ ...component, inputs: {} }] };

const alpha = { domainId: "alpha", id: "projection" };
const beta = { domainId: "beta", id: "projection" };
const alphaPanel = { domainId: "alpha", id: "alpha-panel" };
const betaPanel = { domainId: "beta", id: "beta-panel" };
const hiddenPanel = { domainId: "alpha", id: "private-panel" };
const caller = { userId: "editor", userName: "Editor", roles: [], credentials: { token: "editor-token" } };
const panelUse = (record: typeof alphaPanel) =>
  [productReferenceKey(record), { ...record, inputs: new Set(["value"]), outputs: new Set() }] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [alpha, beta].map(ref => ({
    ...ref, component: component.componentId, definition: { inputs: { value } },
  })) });
  mocks.findProjectionPanelUsers.mockResolvedValue(new Map([
    [productReferenceKey(alpha), new Map([panelUse(alphaPanel), panelUse(hiddenPanel)])],
    [productReferenceKey(beta), new Map([panelUse(betaPanel)])],
  ]));
  mocks.grantedProductIds.mockResolvedValue([alpha.id, alphaPanel.id, betaPanel.id]);
});

it("shows a deployment maintainer every affected projection and panel with its domain", async () => {
  const changes = await checkComponentPackageUpgrade(previous, candidate, {
    ...caller, userId: "superAdmin", diagnosticsScope: "deployment",
  });
  expect(changes).toEqual([{
    component: component.componentId, field: "inputs.value", before: value, after: undefined,
    projectionIds: [alpha.id], panelIds: [alphaPanel.id, betaPanel.id, hiddenPanel.id],
    projections: [alpha, beta], panels: [alphaPanel, hiddenPanel, betaPanel],
  }]);
  expect(mocks.grantedProductIds).not.toHaveBeenCalled();
});

it("limits an author's diagnostics to granted records in that domain", async () => {
  const changes = await checkComponentPackageUpgrade(previous, candidate, { ...caller, domainId: "alpha" });
  expect(changes).toEqual([{
    component: component.componentId, field: "inputs.value", before: value, after: undefined,
    projectionIds: [alpha.id], panelIds: [alphaPanel.id], projections: [alpha], panels: [alphaPanel],
  }]);
  expect(mocks.grantedProductIds).toHaveBeenCalledWith("use", caller.credentials);
});
