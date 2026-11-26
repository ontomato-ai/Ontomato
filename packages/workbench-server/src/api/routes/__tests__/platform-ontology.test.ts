import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { platformOntologyCountsResponseSchema, platformOntologySchemaResponseSchema } from "@ontomato/contracts/platform-ontology";
import { APPLICATION, platformObjectTypes, platformRelationKinds } from "@ontomato/contracts/platform-object-types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { AuthFailedError, backendGet, backendPost } from "../../../utils/backend-client";
import { listAgentDefinitions } from "../../../services/assistant/definitions";
import { assistantSkillCatalog } from "../../../services/assistant/skills";
import { listPublishedDefinitions } from "../../../services/business-definitions/definitions";
import { grantedProductIds } from "../../../services/product-governance/grants";
import { readPanelComponentCatalogue } from "../../../services/product-panels/component-catalogue";
import { platformOntologyRouter } from "../platform-ontology";

vi.mock("../../../utils/backend-client", async (original) => ({
  ...(await original<typeof import("../../../utils/backend-client")>()),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
}));
vi.mock("../../../services/assistant/definitions", () => ({ listAgentDefinitions: vi.fn(), countVisibleAgentDefinitions: vi.fn(async () => 0) }));
vi.mock("../../../services/assistant/skills", () => ({ assistantSkillCatalog: vi.fn(), countAssistantSkills: vi.fn(async () => 0) }));
vi.mock("../../../services/business-definitions/definitions", () => ({ listPublishedDefinitions: vi.fn(), countPublishedDefinitions: vi.fn(async () => 0) }));
vi.mock("../../../identity/management", () => ({ assertManagement: vi.fn(async () => {}) }));
vi.mock("../../../services/product-panels/access", async original => ({
  ...await original<typeof import("../../../services/product-panels/access")>(),
  countUsableCurrentDefinitions: vi.fn(async () => 0),
}));
vi.mock("../../../services/product-governance/grants", () => ({ grantedProductIds: vi.fn() }));
vi.mock("../../../services/product-panels/component-catalogue", () => ({ readPanelComponentCatalogue: vi.fn() }));

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  installWorkbenchIdentity({
    requireDomainId: (id: { domainId?: string | null }) => id.domainId ?? "domain-1",
    assertPermission: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkbenchIdentity);

  vi.mocked(listPublishedDefinitions).mockResolvedValue([]);
  vi.mocked(assistantSkillCatalog).mockResolvedValue({ skills: [] });
  vi.mocked(listAgentDefinitions).mockResolvedValue({ agents: [] });
  vi.mocked(grantedProductIds).mockResolvedValue([]);
  vi.mocked(readPanelComponentCatalogue).mockResolvedValue({
    version: "1.0.0",
    digest: "sha256:test",
    components: new Map(),
  });
  vi.mocked(backendGet).mockResolvedValue({
    text: JSON.stringify({ success: true, data: [] }),
    headers: new Headers(),
    status: 200,
    statusText: "OK",
  });
  vi.mocked(backendPost).mockImplementation(async (_endpoint, url) => ({
    text: JSON.stringify(
      url.endsWith("/authorization/policies/graph-facts")
        ? { rolePolicies: [], domainPolicyId: "default", entries: [], policyGrants: [] }
        : { success: true, data: [] },
    ),
    headers: new Headers(),
    status: 200,
    statusText: "OK",
  }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "user-1", userName: "Alice", domainId: "domain-1", token: "tok-1", locale: "zh-CN" });
    next();
  });
  app.use("/api/platform-ontology", platformOntologyRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("platform-ontology HTTP routes", () => {
  it("serves schema, counts, start, objects, and neighbors", async () => {
    const schemaRes = await fetch(`${base}/api/platform-ontology/schema`);
    expect(schemaRes.status).toBe(200);
    const schema = platformOntologySchemaResponseSchema.parse(await schemaRes.json());
    const expectedTypeCount = Object.values(platformObjectTypes).filter((decl) => Boolean(decl.layer)).length;
    expect(schema.objectTypes).toHaveLength(expectedTypeCount);
    expect(schema.relationKinds).toHaveLength(platformRelationKinds.length);
    const application = schema.objectTypes.find((item) => item.id === APPLICATION);
    expect(application?.definition).toBeTruthy();
    expect(application?.properties?.length).toBeGreaterThan(0);
    expect(application?.reads?.query?.result).toBe("panelRecordQuery");
    expect(application?.reads?.record?.result).toBe("panelRecord");
    expect(application?.operations?.some((op) => op.id === `${APPLICATION}.save`)).toBe(true);

    const startRes = await fetch(`${base}/api/platform-ontology/start`);
    expect(startRes.status).toBe(200);
    expect(await startRes.json()).toEqual({
      node: { className: "platform:User", primaryKey: "user-1", label: "Alice", layer: "governance" },
    });

    const neighborsRes = await fetch(`${base}/api/platform-ontology/neighbors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: { className: "platform:User", primaryKey: "user-1" } }),
    });
    expect(neighborsRes.status).toBe(200);
    const neighbors = (await neighborsRes.json()) as { node: { primaryKey: string }; edges: unknown[]; relations: unknown[] };
    expect(neighbors.node.primaryKey).toBe("user-1");
    expect(neighbors.edges).toEqual([]);
    expect(neighbors.relations.length).toBeGreaterThan(0);

    const objectsRes = await fetch(`${base}/api/platform-ontology/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "platform:Action", keyword: "approve" }),
    });
    expect(objectsRes.status).toBe(200);
    expect(await objectsRes.json()).toMatchObject({ type: "platform:Action", status: "ok", items: [], total: 0 });
  });

  it("returns owner counts without replacing a refusal with zero or querying the list", async () => {
    vi.mocked(backendPost).mockImplementation(async (_endpoint, url, body) => {
      expect(body).toEqual({ countOnly: true });
      const denied = url.endsWith("/trigger/queryList");
      const data = url.endsWith("/admin/getMetas") ? { objectTypes: 2, attributes: 10, relationships: 3 }
        : url.endsWith("/platform/governance/organization") ? { units: 0, positions: 0, grants: 0 }
        : url.endsWith("/workflow/grants") ? { total: 0, outsideDirectory: 0 }
        : { total: 8 };
      return {
        text: JSON.stringify(denied ? { success: false, code: 403, message: "Not admitted" } : { success: true, data }),
        headers: new Headers(), status: 200, statusText: "OK",
      };
    });
    vi.mocked(backendGet).mockResolvedValueOnce({
      text: JSON.stringify({ success: true, data: { total: 0 } }), headers: new Headers(), status: 200, statusText: "OK",
    });
    const response = await fetch(`${base}/api/platform-ontology/counts`);
    expect(response.status).toBe(200);
    const { counts } = platformOntologyCountsResponseSchema.parse(await response.json());
    expect(counts.find(entry => entry.type === "platform:Action")).toMatchObject({ status: "ok", count: 8 });
    const trigger = counts.find(entry => entry.type === "platform:Trigger");
    expect(trigger).toMatchObject({ status: "refused", reason: "Not admitted" });
    expect(trigger).not.toHaveProperty("count");
    expect(vi.mocked(backendPost).mock.calls.map(([, , body]) => body)).not.toContainEqual({});
  });

  it("rejects malformed bodies with 400 and propagates 401 from owner auth failure", async () => {
    const badRes = await fetch(`${base}/api/platform-ontology/neighbors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: { className: "platform:Unknown", primaryKey: "x" } }),
    });
    expect(badRes.status).toBe(400);

    vi.mocked(backendPost).mockRejectedValueOnce(new AuthFailedError("Expired", 401));
    const authRes = await fetch(`${base}/api/platform-ontology/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "platform:Action" }),
    });
    expect(authRes.status).toBe(401);
  });
});
