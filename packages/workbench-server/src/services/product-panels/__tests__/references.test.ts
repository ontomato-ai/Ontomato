import { definePanel, type DirectPanelPortType, type PanelMember } from "@ontomato/contracts/panel-manifest";
import { productProjectionInputSchema, type BuiltinProductPanelInput, type BuiltinProductProjectionInput, type ProductPanelInput } from "@ontomato/contracts/product-panels";
import type { PoolClient } from "pg";
import { beforeAll, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import {
  findPanelUsers, findProjectionPanelUsers, productReferenceKey, validateCurrentProductReferences,
  validateBuiltinProductReferences, validateObjectDetailPanelMapping, validatePersonalPlacement,
} from "../references";

vi.mock("../../../infrastructure/postgres", () => ({ qualifiedTable: (name: string) => name }));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: async () => undefined }));
vi.mock("../../product-governance/service-authentication", () => ({ requireProductGrant: async () => undefined }));

beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
});

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

function storedClient(panels: { id: string; definition: unknown }[], preferences: unknown[] = [],
  projections: Record<string, BuiltinProductProjectionInput> = {},
): PoolClient {
  const query = vi.fn(async (sql: string, params: string[]) => {
    if (sql.includes("FROM product_panels")) return { rows: panels.map(panel => ({ ...panel, domainId: owner.domainId })) };
    if (sql.includes("FROM product_object_details")) return { rows: [] };
    if (sql.includes("FROM user_preferences")) return { rows: preferences };
    if (sql.includes("FROM builtin_product_projections")) {
      const [id] = params;
      const definition = projections[id];
      return { rows: definition ? [{ id, definition, domainId: null, ownerId: null }] : [] };
    }
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


it("checks object identity fields against read parameters when a connected projection is updated", async () => {
  const attributes = productProjectionInputSchema.parse({
    ...projection, componentId: "@ontomato/sdk:ObjectList",
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: "platform:Attribute" } }, read: "list", params: {} } },
  });
  const connected = (type: object) => storedClient([{
    id: "parent", definition: { ...leaf, manifest: {
      state: { selectedNode: { type } },
      members: { rows: {
        target: { projectionId: "attributes" },
        inputs: { className: { state: "selectedNode", field: "primaryKey" } },
      } },
    } },
  }]);
  await expect(validateCurrentProductReferences(owner, viewer, "projection", "attributes", attributes,
    connected({ kind: "object", objectType: "platform:ObjectType" }),
  )).resolves.toBeUndefined();
  await expect(validateCurrentProductReferences(owner, viewer, "projection", "attributes", attributes,
    connected({ kind: "scalar", type: "string" }),
  )).rejects.toMatchObject({ status: 409, code: "PRODUCT_PORT_IN_USE" });
});

const businessId = "builtin-product-business-summary";
const platformId = "builtin-product-platform-summary";
const businessType = { kind: "object", objectType: "platform:ObjectType" } as const;
const platformType = { kind: "object", objectType: "platform:OntologyType" } as const;
const unionType = { kind: "object-union", objectTypes: [businessType.objectType, platformType.objectType] } satisfies DirectPanelPortType;
const version = { kind: "scalar", type: "string" } as const;
const candidateTarget = { fromState: "choice", candidates: { projectionIds: [businessId, platformId] } } satisfies PanelMember["target"];
const builtinProjection = (inputs: BuiltinProductProjectionInput["inputs"], outputs = {}): BuiltinProductProjectionInput => ({
  ...projection, visibility: "platform", inputs, outputs,
});

function connectedPanel(type: DirectPanelPortType, wiring: PanelMember): BuiltinProductPanelInput {
  return {
    ...leaf,
    visibility: "platform",
    manifest: definePanel({
      state: { choice: { type: { kind: "object", objectType: "platform:ProductProjection" } }, selected: { type } },
      members: { summary: wiring },
    }),
  };
}

const noCatalogue = async (): Promise<never> => { throw new Error("These projections have no reads"); };
const verifyBuiltin = (panel: BuiltinProductPanelInput, business: BuiltinProductProjectionInput, platform: BuiltinProductProjectionInput) =>
  validateBuiltinProductReferences(new Map([["builtin-product-summaries", panel]]), new Map([
    [businessId, business], [platformId, platform],
  ]), noCatalogue);

it.each(["object", "list"] as const)("checks candidate coverage for %s inputs while accepting candidate-specific inputs", async kind => {
  const wrap = <T extends typeof businessType | typeof platformType | typeof unionType>(type: T) =>
    kind === "list" ? { kind: "list" as const, items: type } : type;
  const panel = connectedPanel(wrap(unionType), {
    target: candidateTarget,
    inputs: { target: { state: "selected" }, version: { literal: "draft" } },
  });
  const business = builtinProjection({ target: wrap(businessType), version });
  const platform = builtinProjection({ target: wrap(platformType) });
  await expect(verifyBuiltin(panel, business, platform)).resolves.toBeUndefined();
  await expect(verifyBuiltin(panel, builtinProjection({ target: wrap(businessType) }), platform)).rejects.toThrow(/version/u);
  await expect(verifyBuiltin(panel, business, builtinProjection({ target: wrap(businessType) }))).rejects.toThrow(/platform:OntologyType/u);
  await expect(verifyBuiltin(panel, business, builtinProjection({ target: kind === "list"
    ? { kind: "list", items: { kind: "object", objectType: "platform:User" } }
    : { kind: "object", objectType: "platform:User" },
  }))).rejects.toThrow(/target/u);
});

it("keeps fixed inputs and every candidate's outputs strict", async () => {
  const fixed = connectedPanel(unionType, { target: { projectionId: businessId }, inputs: { target: { state: "selected" } } });
  await expect(verifyBuiltin(fixed, builtinProjection({ target: unionType }), builtinProjection({}))).resolves.toBeUndefined();
  await expect(verifyBuiltin(fixed, builtinProjection({ target: businessType }), builtinProjection({}))).rejects.toThrow(/target/u);

  const dynamic = connectedPanel(unionType, { target: candidateTarget, outputs: { selected: { state: "selected" } } });
  const business = builtinProjection({}, { selected: businessType });
  await expect(verifyBuiltin(dynamic, business, builtinProjection({}, { selected: platformType }))).resolves.toBeUndefined();
  await expect(verifyBuiltin(dynamic, business, builtinProjection({}))).rejects.toThrow(/selected/u);
});

it("protects the whole candidate group when a connected projection is updated", async () => {
  const editableId = "platform-summary";
  const panel = connectedPanel(unionType, {
    target: { fromState: "choice", candidates: { projectionIds: [businessId, editableId] } },
    inputs: { target: { state: "selected" }, version: { literal: "draft" } },
  });
  const business = builtinProjection({ target: businessType, version });
  const platform = { ...projection, inputs: { target: platformType } };
  const client = storedClient([{ id: "summaries", definition: panel }], [], { [businessId]: business });
  await expect(validateCurrentProductReferences(owner, viewer, "projection", editableId, platform, client)).resolves.toBeUndefined();
  await expect(validateCurrentProductReferences(owner, viewer, "projection", editableId,
    { ...platform, inputs: { target: businessType } }, client,
  )).rejects.toMatchObject({ status: 409, code: "PRODUCT_PORT_IN_USE" });
});
