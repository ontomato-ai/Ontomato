import { definePanel } from "@ontomato/contracts/panel-manifest";
import { productProjectionInputSchema, type ProductPanelInput } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import {
  findPanelUsers, findProjectionPanelUsers, productReferenceKey, validateCurrentProductReferences,
  validateObjectDetailPanelMapping, validatePersonalPlacement,
} from "../references";

vi.mock("../../../infrastructure/postgres", () => ({ qualifiedTable: (name: string) => name }));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: async () => undefined }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: async () => undefined }));

const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "token-1", locale: "en" };
const leaf: ProductPanelInput = {
  name: "Leaf", description: "", visibility: "domain", content: { html: "<main></main>" },
  manifest: definePanel({ state: {}, members: {} }),
};
const projection = productProjectionInputSchema.parse({
  name: "Projection", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
  inputs: {}, outputs: {}, config: {}, data: {},
});
const rows = [
  { id: "leaf", definition: leaf },
  { id: "healthy-parent", definition: { ...leaf, name: "Healthy parent", manifest: {
    state: {}, members: { child: { target: { panelId: "leaf" } } },
  } } },
  { id: "app-ops-model", definition: { name: "Model", manifest: { state: {}, members: {
    model: { target: { projectionId: "broken-member-target" }, formField: "legacy" },
    child: { target: { panelId: "leaf" } },
    summary: { target: { projectionId: "summary" } },
  } } } },
  { id: "sample-ontology-graph-panel", definition: { name: " ", manifest: {
    state: { positions: { type: "legacy-type" } }, members: { child: { target: { panelId: "leaf" } } },
  } } },
  { id: "missing-manifest", definition: { name: "Unreadable" } },
];

function storedClient(panels: { id: string; definition: unknown }[], preferences: unknown[] = []): PoolClient {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM product_panels")) return { rows: panels.map(panel => ({ ...panel, domainId: owner.domainId })) };
    if (sql.includes("FROM product_object_details")) return { rows: [] };
    if (sql.includes("FROM user_preferences")) return { rows: preferences };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as PoolClient;
}

it("finds healthy users and readable members of damaged panels, skipping rows without a manifest", async () => {
  const client = storedClient(rows);
  await expect(findPanelUsers(owner.domainId, "panel", "leaf", client)).resolves.toEqual([
    { id: "healthy-parent", name: "Healthy parent" },
    { id: "app-ops-model", name: "Model" },
    { id: "sample-ontology-graph-panel", name: "sample-ontology-graph-panel" },
  ]);
  await expect(findPanelUsers(owner.domainId, "projection", "broken-member-target", client)).resolves.toEqual([]);
});

it("keeps a placement's candidates and valid saved values when its default and another saved value are malformed", async () => {
  const client = storedClient([...rows, { id: "layout", definition: { name: "Personal layout", manifest: {
    members: {}, state: { child: {
      personal: true, type: { kind: "placement", candidates: { rule: "objectDetail" } },
      default: { target: { panelId: "bad-default" } },
    }, widget: {
      type: { kind: "placement", candidates: { projectionIds: ["summary"] } },
      default: { target: { projectionId: "summary" } },
    } },
  } } }], [
    { scope: [owner.domainId, "layout", [], "layout", "child"], value: { target: { panelId: "bad-preference" } } },
    { scope: [owner.domainId, "layout", [], "layout", "child"], value: { id: "saved", target: { panelId: "saved-leaf" } } },
  ]);
  await expect(findPanelUsers(owner.domainId, "panel", "saved-leaf", client)).resolves.toEqual([
    { id: "layout", name: "Personal layout" },
  ]);
  await expect(findPanelUsers(owner.domainId, "projection", "summary", client)).resolves.toEqual([
    { id: "app-ops-model", name: "Model" },
    { id: "layout", name: "Personal layout" },
  ]);
  const target = { id: "summary", domainId: owner.domainId };
  const users = await findProjectionPanelUsers([target], client);
  expect(users.get(productReferenceKey(target))?.has(productReferenceKey({ ...target, id: "layout" }))).toBe(true);
});

it("allows saving healthy products with damaged users in the same domain", async () => {
  const client = storedClient(rows);
  await expect(validateCurrentProductReferences(owner, viewer, "panel", "leaf", leaf, client)).resolves.toBeUndefined();
  await expect(validateCurrentProductReferences(owner, viewer, "projection", "summary", projection, client)).resolves.toBeUndefined();
});

it.each(["app-ops-model", "sample-ontology-graph-panel", "missing-manifest"])("rejects new references to %s", async panelId => {
  const client = storedClient(rows);
  const target = { panelId };
  const parent = { ...leaf, manifest: definePanel({ state: {}, members: { child: { target } } }) };
  const unavailable = { status: 404, code: "PRODUCT_UNAVAILABLE" };
  await expect(validateCurrentProductReferences(owner, viewer, "panel", "new-parent", parent, client)).rejects.toMatchObject(unavailable);
  await expect(validateObjectDetailPanelMapping(owner.domainId, "Example", panelId, client)).rejects.toMatchObject(unavailable);
  await expect(validatePersonalPlacement(owner, viewer, parent, new Set(), "child", { id: "placement", target }, client)).rejects.toMatchObject(unavailable);
});
