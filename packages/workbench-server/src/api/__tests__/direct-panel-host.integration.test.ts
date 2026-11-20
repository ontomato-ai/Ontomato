import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  APPLICATION_PANEL_REFERENCES_PATH, productPanelResponseSchema, productProjectionResponseSchema,
  registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import { panelOperationDescriptorResponseSchema } from "@ontomato/contracts/panel-agent";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import {
  panelDefinitionSnapshotSchema, productDefinitionStreamFrameSchema, productDefinitionStreamRequestSchema,
  type ProductDefinitionRevision,
} from "@ontomato/contracts/product-subscriptions";
import { installContentLayout } from "../../content/layout";
import { readSseFrames } from "../../infrastructure/agent-runtime/client";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }) } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const trial = await import(fileURLToPath(new URL("../../../../apps-sdk/examples/panels/schedules-trial/definitions.mjs", import.meta.url))) as {
  panels: { id: string; directory: string; name: string; description: string; manifest: unknown }[];
  projections: { id: string; input: Record<string, unknown> & {
    data: Record<string, { source: { type: string } | { operation: string } | { object: { input: string } }; read: string; params: object }>;
  } }[];
  panelContent(directory: string): unknown;
};
let server: Server;
let contentRoot: string;
const grants = new Set<string>();
const codePanelId = "panel-schedules-mixed";

beforeAll(async () => {
  state.schema = `direct_panel_host_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "direct-panel-host-"));
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { panelOperationsRouter, productPanelsInternalRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    res.json({ allowed: grants.has(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    res.json({ ids: [...grants] });
  });
  app.get("/platform/applications/app-mixed/panel-uses", (req, res) => {
    expect(req.header("tk")).toBe("host-reader");
    res.json({ success: true, data: {
      applicationId: "app-mixed", entry: { path: "/applications/app-mixed", renderer: "panels" },
      panelUses: [{ id: "mixed", pageKey: "mixed", path: "/applications/app-mixed/mixed",
        panelId: codePanelId, access: { kind: "domain-member" } }],
    } });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: "pilot", userId: "reader", token: "host-reader", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  app.use("/internal/product-panels", productPanelsInternalRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object, signal?: AbortSignal) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
}

function projectionRequest(input: (typeof trial.projections)[number]["input"], revision: number) {
  const data = Object.fromEntries(Object.entries(input.data).map(([name, datum]) => {
    const { source } = datum;
    const binding = "type" in source ? { type: { kind: "PlatformObjectType", id: source.type } }
      : "operation" in source ? { operation: { kind: "PlatformOperation", id: source.operation } } : source;
    return [name, { ...datum, source: binding }];
  }));
  return registerProductProjectionRequestSchema.parse({ ...input, data, revision });
}

it("reads the registered trial and follows its directly placed projections through the host routes", async () => {
  const { id, directory, name, description, manifest } = trial.panels.find(entry => entry.id === "panel-schedules-trial")!;
  for (const projection of trial.projections) {
    const body = projectionRequest(projection.input, 0);
    const response = await request("PUT", `product-projections/${projection.id}`, body);
    expect(response.status, await response.text()).toBe(200);
  }
  const body = registerProductPanelRequestSchema.parse({
    name, description, manifest, visibility: "domain", content: trial.panelContent(directory), revision: 0,
  });
  const saved = await request("PUT", `product-panels/${id}`, body);
  expect(saved.status, await saved.text()).toBe(200);

  const panelResponse = await request("GET", `product-panels/${id}`);
  expect(panelResponse.status).toBe(200);
  const panelPayload = await panelResponse.json();
  const { panel } = productPanelResponseSchema.parse(panelPayload);
  const snapshotResponse = await request("GET", `product-panels/${id}/snapshot`);
  const snapshotPayload = await snapshotResponse.json();
  expect(snapshotResponse.status, JSON.stringify(snapshotPayload)).toBe(200);
  const snapshot = panelDefinitionSnapshotSchema.parse(snapshotPayload);
  expect(snapshot.panel).toEqual({ id, revision: panel.revision });
  expect(snapshot.projections.map(projection => projection.id)).toEqual(
    Object.values(panel.manifest.members).flatMap(({ target }) => "projectionId" in target ? [target.projectionId] : []),
  );

  const projectionPayloads: Record<string, unknown> = {};
  const projectionDefinitions: ProductDefinitionRevision[] = [];
  for (const reference of snapshot.projections) {
    const response = await request("GET", `product-projections/${reference.id}`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(productProjectionResponseSchema.parse(payload).projection).toMatchObject({
      ...reference, data: expect.any(Object),
    });
    projectionPayloads[reference.id] = payload;
    projectionDefinitions.push({ kind: "projection" as const, ...reference });
  }
  const expected = [{ kind: "panel" as const, ...snapshot.panel }, ...projectionDefinitions];
  const { targets } = productDefinitionStreamRequestSchema.parse({ targets: expected.map(({ kind, id }) => ({ kind, id })) });
  const controller = new AbortController();
  const frames: string[] = [];
  try {
    const stream = await request("POST", "product-panels/definition-stream", { targets }, controller.signal);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await readSseFrames(stream, productDefinitionStreamFrameSchema.parse, async frame => {
      frames.push(frame.kind);
      if (frame.kind === "snapshot") {
        expect(frame.definitions).toEqual(expected);
        const projectionId = projectionDefinitions[0]!.id;
        const projection = trial.projections.find(item => item.id === projectionId)!;
        const update = await request("PUT", `product-projections/${projectionId}`, {
          ...projectionRequest(projection.input, projectionDefinitions[0]!.revision), name: "Updated summary",
        });
        expect(update.status, await update.text()).toBe(200);
      } else {
        expect(frame.definition).toEqual({ ...projectionDefinitions[0], revision: projectionDefinitions[0]!.revision + 1 });
        controller.abort();
      }
    }, controller.signal);
  } finally {
    controller.abort();
  }
  expect(frames).toEqual(["snapshot", "definition-changed"]);

  const deniedProjection = "projection-schedules-summary";
  grants.delete(deniedProjection);
  const partial = await request("GET", `product-panels/${id}/snapshot`);
  expect(partial.status).toBe(200);
  const partialSnapshot = panelDefinitionSnapshotSchema.parse(await partial.json());
  expect(partialSnapshot.members).toContainEqual({ status: "forbidden", memberPath: [{ member: "summary" }] });
  expect(partialSnapshot.projections.map(projection => projection.id)).not.toContain(deniedProjection);
  expect(partialSnapshot.members).toContainEqual(expect.objectContaining({
    status: "ready", memberPath: [{ member: "run" }], target: { kind: "projection", id: "projection-schedules-run" },
  }));

  const evidencePath = process.env.DIRECT_PANEL_HOST_HTTP_EVIDENCE;
  if (evidencePath) {
    await writeFile(evidencePath, JSON.stringify({ panel: panelPayload, snapshot: snapshotPayload, projections: projectionPayloads }, null, 2) + "\n");
  }
});

it("re-registers a stored code panel at its current revision and describes its member operation", async () => {
  const summaryId = "mixed-summary", runId = "mixed-run";
  for (const [id, source] of [[summaryId, "projection-schedules-summary"], [runId, "projection-schedules-run"]] as const) {
    const { input } = trial.projections.find(projection => projection.id === source)!;
    const response = await request("PUT", "product-projections/" + id, projectionRequest(input, 0));
    expect(response.status, await response.text()).toBe(200);
  }
  const trialPanel = trial.panels.find(panel => panel.id === "panel-schedules-summary")!;
  const content = trial.panelContent(trialPanel.directory);
  const definition = {
    name: trialPanel.name, description: trialPanel.description, visibility: "domain", content,
    sdkVersion: "1.0.0-fixture", manifest: trialPanel.manifest,
  };
  // This row was authored before the unified member contract.
  await state.pool!.query(
    `INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition) VALUES ($1,$2,$3,$4)`,
    ["pilot", codePanelId, "reader", definition],
  );
  grants.add(codePanelId);

  const directTrial = trial.panels.find(panel => panel.id === "panel-schedules-trial")!;
  const { state: panelState, members } = panelManifestSchema.parse(directTrial.manifest);
  const replacement = {
    name: definition.name, description: definition.description, visibility: definition.visibility, content,
    manifest: { state: panelState, events: {}, members: {
      summary: { ...members.summary, target: { projectionId: summaryId } },
      run: { ...members.run, target: { projectionId: runId } },
    } },
  };
  const panelPath = "product-panels/" + codePanelId;
  const stale = await request("PUT", panelPath, { ...replacement, revision: 2 });
  expect(stale.status, await stale.text()).toBe(409);
  const stored = await state.pool!.query(
    `SELECT revision,definition FROM "${state.schema}".product_panels WHERE domain_id=$1 AND id=$2`,
    ["pilot", codePanelId],
  );
  expect(stored.rows).toEqual([{ definition, revision: 1 }]);

  const saved = await request("PUT", panelPath, { ...replacement, revision: 1 });
  expect(saved.status, await saved.text()).toBe(200);
  const readback = await request("GET", panelPath);
  expect(readback.status).toBe(200);
  const { panel } = productPanelResponseSchema.parse(await readback.json());
  expect(panel).toMatchObject({ id: codePanelId, ownerId: "reader", revision: 2, ...replacement });
  expect(panel).not.toHaveProperty("sdkVersion");
  const snapshot = await request("GET", panelPath + "/snapshot");
  expect(snapshot.status).toBe(200);
  const current = panelDefinitionSnapshotSchema.parse(await snapshot.json());
  expect(current.panel).toEqual({ id: codePanelId, revision: 2 });
  expect([...current.projections].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
    { id: runId, revision: 1 }, { id: summaryId, revision: 1 },
  ]);

  const describe = (operationId: string) => request("GET", "panel-operations/descriptor?" +
    new URLSearchParams({ applicationId: "app-mixed", useId: "mixed", operationId }));
  const response = await describe("run.runNow");
  const payload = await response.json();
  expect(response.status, JSON.stringify(payload)).toBe(200);
  expect(panelOperationDescriptorResponseSchema.parse(payload)).toMatchObject({
    handlerRef: "schedules.runNow", effect: "write", target: { source: "input", input: "task" },
  });
  expect((await describe("summary.runNow")).status).toBe(422);

  const application = {
    domainId: "pilot",
    uses: [{ id: "mixed", panelId: codePanelId, inputs: { selectedTask: { literal: null } } }],
    delivery: { panels: [codePanelId], projections: [summaryId, runId] },
  };
  const validate = (body: object, token = "fixture-service") => fetch(state.base + APPLICATION_PANEL_REFERENCES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": token },
    body: JSON.stringify(body),
  });
  expect((await validate(application, "reader")).status).toBe(403);
  const allowed = await validate(application);
  expect(allowed.status, await allowed.text()).toBe(204);
  expect((await validate({ ...application, delivery: { panels: [], projections: [] } })).status).toBe(204);
  const invalidInput = await validate({ ...application, uses: [{
    ...application.uses[0], inputs: { selectedTask: { literal: "not an object" } },
  }] });
  expect(invalidInput.status).toBe(400);
  expect((await invalidInput.json()).error.message).toContain("selectedTask");
  const unreachable = await validate({ ...application, delivery: { panels: [], projections: ["unreachable"] } });
  expect(unreachable.status).toBe(400);
  expect((await unreachable.json()).error.message).toContain("unreachable");
});
