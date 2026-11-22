import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { createServer, type Server } from "node:http";
import express from "express";
import pg from "pg";
import { draftTarget, pageDraftReadSchema } from "@ontomato/contracts/page-draft";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * What a create draft's first save created: the assistant's own route over PostgreSQL. Only the agent runtime, which
 * holds the run's files, is doubled; the conversation, its run and the record are real rows.
 */
type RunFile = { id: string; sessionId: string; runId: string; path: string; draft: object };
const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", files: [] as RunFile[] }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../infrastructure/agent-runtime/client", async (importOriginal) => {
  const metadata = ({ draft: _draft, ...file }: RunFile) => ({
    ...file, toolCallId: null, createdAt: "2026-11-18T00:00:00Z", seq: 1, sha256: "0".repeat(64), size: 1, mediaType: "application/json",
  });
  const file = (id: string) => state.files.find((candidate) => candidate.id === id)!;
  class RuntimeClient {
    async request(path: string) {
      const request = new URL(path, "http://runtime");
      const run = /^\/v1\/runs\/([^/]+)\/artifacts$/.exec(request.pathname);
      if (!run) return metadata(file(/^\/v1\/artifacts\/([^/]+)$/.exec(path)![1]!));
      const at = request.searchParams.get("path");
      const artifacts = state.files.filter((candidate) => candidate.runId === run[1] && candidate.path === at).map(metadata);
      const samePathInAnotherRun = request.searchParams.get("checkOtherRuns") === "true" && !artifacts.length
        && state.files.some(candidate => candidate.sessionId === sessionId && candidate.runId !== run[1] && candidate.path === at);
      return { artifacts, ...(samePathInAnotherRun && { samePathInAnotherRun }) };
    }
    async bytes(path: string) {
      return Buffer.from(JSON.stringify(file(/^\/v1\/artifacts\/([^/]+)\/content$/.exec(path)![1]!).draft));
    }
  }
  return { ...(await importOriginal<typeof import("../../infrastructure/agent-runtime/client")>()), RuntimeClient };
});
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureAssistantPageDraftCreationsSchema } from "../../infrastructure/postgres-migrations/20261118-assistant-page-draft-creations/schema";
import { installContentLayout } from "../../content/layout";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
// A database-backed suite never skips silently: the integration command requires a disposable database.
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

installWorkbenchIdentity({
  requireDomainId: (identity: { domainId?: string | null }) => identity.domainId ?? "domain",
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
} as unknown as WorkbenchIdentity);

const DRAFT = "outputs/drafts/agent.page-draft.json";
const sessionId = randomUUID(), runId = randomUUID(), updateRunId = randomUUID(), invalidRunId = randomUUID();
const emptyRunId = randomUUID();
const outsideDraft = "outputs/drafts/outside.page-draft.json";
const createDraft = { pageKey: "agent-settings", operation: "agent.create", target: { objectType: "platform:AgentDefinition" }, form: { name: "New analyst" } };
const updateDraft = { pageKey: "ontology", operation: "objectType.update",
  target: { objectType: "platform:ObjectType", id: "owner:table/one" }, form: { displayName: "Renamed" } };
const invalidTargets = [
  { target: {}, field: "target.objectType" },
  { target: { id: "legacy" }, field: "target.objectType" },
  { target: { objectType: "" }, field: "target.objectType" },
  { target: { objectType: "platform:ObjectType", id: null }, field: "target.id" },
].map(item => ({ ...item, run: randomUUID() }));
let server: Server, base = "";

beforeAll(async () => {
  state.schema = `page_draft_created_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);
  await ensureAssistantPageDraftCreationsSchema(state.pool);
  await state.pool.query(`INSERT INTO "${state.schema}".assistant_sessions (id,domain_id,owner_id,agent_id) VALUES ($1,'domain','alice',$2)`, [sessionId, randomUUID()]);
  for (const [seq, run] of [emptyRunId, runId, updateRunId, invalidRunId, ...invalidTargets.map(item => item.run)].entries())
    await state.pool.query(`INSERT INTO "${state.schema}".assistant_turns (id,session_id,request_seq,input_hash) VALUES ($1,$2,$3,'hash')`, [run, sessionId, seq]);
  state.files.push({ id: randomUUID(), sessionId, runId, path: DRAFT, draft: createDraft });
  state.files.push({ id: randomUUID(), sessionId, runId: updateRunId, path: DRAFT, draft: updateDraft });
  state.files.push({ id: randomUUID(), sessionId: randomUUID(), runId: randomUUID(), path: outsideDraft, draft: createDraft });

  state.files.push({ id: randomUUID(), sessionId, runId: invalidRunId, path: DRAFT,
    draft: { pageKey: "ontology", operation: "objectType.create", target: { objectType: "platform:ObjectType" }, form: { "/className": "bin" } },
  });

  for (const item of invalidTargets) state.files.push({
    id: randomUUID(), sessionId, runId: item.run, path: DRAFT, draft: { ...createDraft, target: item.target },
  });

  // The router reads the public skills' place when it loads, so the layout is installed first.
  const runtimeRoot = mkdtempSync(nodePath.join(os.tmpdir(), "page-draft-created-"));
  installContentLayout({ runtimeRoot, publicSkillsRoot: runtimeRoot, prompts: [], runtimeResources: [] });
  const { default: assistantRouter } = await import("../routes/assistant");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: req.header("x-user") ?? "alice", domainId: "domain", token: "token", apiKey: "", locale: "en" });
    next();
  });
  app.use("/api/assistant", assistantRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/assistant/sessions/${sessionId}/runs`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
});

const read = (run: string, user = "alice", path = DRAFT) =>
  fetch(`${base}/${run}/page-draft?${new URLSearchParams({ path })}`, { headers: { "x-user": user } });
const record = (run: string, id: string, user = "alice") =>
  fetch(`${base}/${run}/page-draft/created`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-user": user }, body: JSON.stringify({ path: DRAFT, id }),
  });
const rows = async () =>
  (await state.pool!.query(`SELECT session_id,run_id,path,created_id FROM "${state.schema}".assistant_page_draft_creations`)).rows;

describe("what a create draft created", () => {
  it("hints that the same draft path exists in another owned run without loading it", async () => {
    const missing = await read(emptyRunId);
    expect(missing.status).toBe(404);
    const body = await missing.json();
    expect(body.error.code).toBe("PAGE_DRAFT_NOT_FOUND");
    expect(body.details).toEqual({ samePathInAnotherRun: true });
    expect(JSON.stringify(body)).not.toContain(runId);

    const outside = await read(emptyRunId, "alice", outsideDraft);
    expect(outside.status).toBe(404);
    expect(await outside.json()).not.toHaveProperty("details");
    const denied = await read(emptyRunId, "bob");
    expect(denied.status).toBe(404);
    expect(await denied.json()).not.toHaveProperty("details");
  });

  it("is recorded once, read with the draft, the same again accepted and another refused", async () => {
    expect(await (await read(runId)).json()).toEqual(createDraft);

    expect((await record(runId, "agent-1")).status).toBe(204);
    const recorded = pageDraftReadSchema.parse(await (await read(runId)).json());
    expect(recorded).toEqual({ ...createDraft, created: { id: "agent-1" } });
    expect(draftTarget(recorded)).toEqual({ kind: "update", objectType: "platform:AgentDefinition", id: "agent-1" });
    // The same save reported again is the same record.
    expect((await record(runId, "agent-1")).status).toBe(204);
    const other = await record(runId, "agent-2");
    expect(other.status).toBe(409);
    expect((await other.json()).error.code).toBe("PAGE_DRAFT_CREATED_CONFLICT");
    expect(await rows()).toEqual([{ session_id: sessionId, run_id: runId, path: DRAFT, created_id: "agent-1" }]);
  });

  it("is refused for a draft that already names its object", async () => {
    const refused = await record(updateRunId, "agent-3");
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("PAGE_DRAFT_NOT_CREATE");
    expect(await (await read(updateRunId)).json()).toEqual(updateDraft);
    expect((await rows()).filter((row) => row.run_id === updateRunId)).toEqual([]);
  });

  it("is recorded and read only by the reader who may read the draft", async () => {
    expect((await read(runId, "bob")).status).toBe(404);
    expect((await record(runId, "agent-1", "bob")).status).toBe(404);
    expect((await record(runId, "agent-4", "bob")).status).toBe(404);
    expect((await rows()).filter((row) => row.run_id === runId).map((row) => row.created_id)).toEqual(["agent-1"]);
  });

  it("rejects a pointer used as a draft form key before the page receives it", async () => {
    const response = await read(invalidRunId);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST", message: expect.stringContaining('form key "/className"') },
    });
    expect((await rows()).filter(row => row.run_id === invalidRunId)).toEqual([]);
  });

  it.each(invalidTargets)("rejects the stored draft's invalid $field on read and on its receipt", async ({ run, field }) => {
    for (const response of [await read(run), await record(run, "new")]) {
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toContain(DRAFT);
      expect(body.error.message).toContain(run);
      expect(body.error.message).toContain(field);
    }
    expect((await rows()).filter(row => row.run_id === run)).toEqual([]);
  });

  it("goes with its conversation", async () => {
    await state.pool!.query(`DELETE FROM "${state.schema}".assistant_sessions WHERE id=$1`, [sessionId]);
    expect(await rows()).toEqual([]);
  });
});
