import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runtimeSessionRunFrameSchema } from "@ontomato/contracts/agent-runtime-events";
import type {
  AgentHostService,
  AgentHostOwner,
} from "../../../services/agent-host/types";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
import { HttpError } from "../../../utils/errors";
import { createAgentHostRouter } from "../agent-host";

const owner: AgentHostOwner = { domainId: "domain-a", userId: "alice" };
const sessionId = "11111111-1111-4111-8111-111111111111";
const secondSessionId = "22222222-2222-4222-8222-222222222222";
const foreignSessionId = "55555555-5555-4555-8555-555555555555";
const runId = "44444444-4444-4444-8444-444444444444";
const agentId = "33333333-3333-4333-8333-333333333333";
const view = {
  id: sessionId,
  agentId,
  title: "Session",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  latestRun: null,
};

/** A host without enterprise identity: a request is only authenticated when the fixture says so. */
const identity = {
  requireDomainId(value: { domainId?: string | null }) {
    if (!value.domainId) throw new HttpError(401, "Domain required", "UNAUTHENTICATED");
    return value.domainId;
  },
} as unknown as WorkbenchIdentity;

/** Answers as the real service would: anything outside the owner set does not exist. */
function fakeService() {
  const seen: AgentHostOwner[] = [];
  const own = (caller: AgentHostOwner) => {
    seen.push(caller);
    if (caller.domainId !== owner.domainId || caller.userId !== owner.userId)
      throw new HttpError(404, "Conversation not found", "NOT_FOUND");
    return caller;
  };
  const created = new Set<string>();
  const readable = new Set([sessionId, secondSessionId]);
  return {
    seen: () => seen.filter((caller) => caller.userId === owner.userId),
    service: {
      agents: async (caller: AgentHostOwner) => (own(caller), { agents: [] }),
      list: async (caller: AgentHostOwner) => (own(caller), { sessions: [view], nextCursor: null }),
      readableSessions: async (caller: AgentHostOwner, ids: string[]) => {
        readableCalls.push(ids);
        return new Set(
          ids.filter(
            (id) =>
              caller.domainId === owner.domainId &&
              caller.userId === owner.userId &&
              readable.has(id),
          ),
        );
      },
      snapshot: async (id: string, caller: AgentHostOwner) => (
        own(caller), { session: { ...view, id }, messages: [], latestRun: null }
      ),
      rename: async (_id: string, title: string, caller: AgentHostOwner) => { own(caller); view.title = title; },
      create: async (id: string, caller: AgentHostOwner) => {
        own(caller);
        const replayed = created.has(id);
        created.add(id);
        return { session: { ...view, id }, replayed };
      },
    } as unknown as AgentHostService,
  };
}

let server: Server, url: string, fake: ReturnType<typeof fakeService>;
let runtimeServer: Server;
let runtimeHeaderCalls: Array<Record<string, string | string[] | undefined>> = [];
let statusCalls: Array<{ sessionIds: string[] }> = [];
let readableCalls: string[][] = [];

beforeAll(async () => {
  installWorkbenchIdentity(identity);
  fake = fakeService();
  runtimeServer = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/v1/sessions/status") {
      const body = JSON.parse(raw) as { sessionIds: string[] };
      statusCalls.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessions: body.sessionIds.map((id) => ({
            session: {
              id,
              domainId: owner.domainId,
              workspaceId: null,
              activeRunId: null,
              latestRunId: null,
              createdAt: "2026-10-30T00:00:00.000Z",
              updatedAt: "2026-10-30T00:00:00.000Z",
            },
            latestRun:
              id === sessionId
                ? { id: runId, status: "running", stopReason: null }
                : null,
          })),
        }),
      );
      return;
    }
    if (req.url === "/v1/sessions/run-events") {
      runtimeHeaderCalls.push(req.headers);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const frame of [
        { type: "ready" },
        { type: "run_started", sessionId, runId },
        { type: "run_started", sessionId: foreignSessionId, runId },
        { type: "run_stopped", sessionId, runId },
      ])
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "fixture" } }));
  });
  await new Promise<void>((resolve) => runtimeServer.listen(0, "127.0.0.1", resolve));
  process.env.AGENT_RUNTIME_URL = `http://127.0.0.1:${(runtimeServer.address() as { port: number }).port}`;
  process.env.AGENT_RUNTIME_SERVICE_TOKEN = "fixture-runtime-token";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // The authentication boundary writes identity; the request body never supplies it.
    const caller = req.header("fixture-auth");
    if (caller) Object.assign(req as AuthenticatedRequest, { ...owner, userId: caller });
    next();
  });
  app.use("/api/agent-host", createAgentHostRouter(fake.service));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agent-host`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  runtimeServer.closeAllConnections();
  await new Promise<void>((resolve) => runtimeServer.close(() => resolve()));
});

const auth = { "fixture-auth": owner.userId, "Content-Type": "application/json" };

it("refuses a request that never passed authentication", async () => {
  const response = await fetch(url + `/sessions/${sessionId}`);
  expect(response.status).toBe(401);
  expect(fake.seen()).toEqual([]);
});

it("answers a session outside the verified owner as not found", async () => {
  const response = await fetch(url + `/sessions/${sessionId}`, {
    headers: { "fixture-auth": "bob" },
  });
  expect(response.status).toBe(404);
});

it("creates a session with the verified owner and replays the same id", async () => {
  const create = () =>
    fetch(url + "/sessions", {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": sessionId },
      body: JSON.stringify({ agentId }),
    });
  expect(await (await create()).json()).toEqual({ session: view, replayed: false });
  expect(await (await create()).json()).toEqual({ session: view, replayed: true });
  expect(fake.seen()).toEqual([owner, owner]);
});

it("renames only the caller's conversation and rejects blank or oversized titles", async () => {
  const rename = (title: string, user = owner.userId) => fetch(url + `/sessions/${sessionId}`, {
    method: "PATCH", headers: { ...auth, "fixture-auth": user }, body: JSON.stringify({ title }),
  });
  expect((await rename("Private title", "bob")).status).toBe(404);
  expect((await rename("   ")).status).toBe(400);
  expect((await rename("a".repeat(201))).status).toBe(400);
  expect((await rename("  Renamed conversation  ")).status).toBe(204);
  expect((await (await fetch(url + `/sessions/${sessionId}`, { headers: auth })).json()).session.title).toBe("Renamed conversation");
});

it("returns ordered light run state for readable sessions and drops unreadable IDs", async () => {
  statusCalls = [];
  readableCalls = [];
  const statuses = (sessionIds: string[], headers = auth) =>
    fetch(url + "/sessions/status", {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionIds }),
    });
  const readable = await statuses([sessionId, secondSessionId]);
  expect(readable.status).toBe(200);
  expect(await readable.json()).toEqual({
    sessions: [
      { sessionId, latestRun: { id: runId, status: "running", stopReason: null } },
      { sessionId: secondSessionId, latestRun: null },
    ],
  });
  expect(statusCalls).toEqual([{ sessionIds: [sessionId, secondSessionId] }]);
  // The page's whole loaded set is one readability query, and the runtime only sees the
  // subset that passed this entry's read rule.
  expect(readableCalls).toEqual([[sessionId, secondSessionId]]);
  const empty = await statuses([]);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ sessions: [] });
  expect(statusCalls).toHaveLength(1);
  expect(readableCalls).toHaveLength(1);
  // A deleted or foreign ID in the loaded set is dropped, not failed: the rest still
  // updates and the reader cannot tell missing from someone else's.
  const foreign = await statuses([sessionId, foreignSessionId]);
  expect(foreign.status).toBe(200);
  expect(await foreign.json()).toEqual({
    sessions: [
      { sessionId, latestRun: { id: runId, status: "running", stopReason: null } },
    ],
  });
  expect(statusCalls).toEqual([
    { sessionIds: [sessionId, secondSessionId] },
    { sessionIds: [sessionId] },
  ]);
  expect(readableCalls).toEqual([
    [sessionId, secondSessionId],
    [sessionId, foreignSessionId],
  ]);
  const other = await statuses([sessionId], { ...auth, "fixture-auth": "bob" });
  expect(other.status).toBe(200);
  expect(await other.json()).toEqual({ sessions: [] });
  expect(statusCalls).toHaveLength(2);
  expect(readableCalls).toEqual([
    [sessionId, secondSessionId],
    [sessionId, foreignSessionId],
    [sessionId],
  ]);
});

it("forwards ready and only the caller's readable run notices", async () => {
  runtimeHeaderCalls = [];
  const response = await fetch(url + "/sessions/run-events", { headers: auth });
  expect(response.status).toBe(200);
  const frames = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => runtimeSessionRunFrameSchema.parse(JSON.parse(line.slice(6))));
  expect(frames).toEqual([
    { type: "ready" },
    { type: "run_started", sessionId, runId },
    { type: "run_stopped", sessionId, runId },
  ]);
  const headers = runtimeHeaderCalls.at(-1);
  expect(headers?.authorization).toBe("Bearer fixture-runtime-token");
  expect(headers?.["x-domain-id"]).toBe(owner.domainId);
  const stranger = await fetch(url + "/sessions/run-events", {
    headers: { ...auth, "fixture-auth": "bob" },
  });
  expect(stranger.status).toBe(200);
  const strangerFrames = (await stranger.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => runtimeSessionRunFrameSchema.parse(JSON.parse(line.slice(6))));
  expect(strangerFrames).toEqual([{ type: "ready" }]);
});

it("refuses the list stream before opening the runtime stream", async () => {
  runtimeHeaderCalls = [];
  const response = await fetch(url + "/sessions/run-events");
  expect(response.status).toBe(401);
  expect(runtimeHeaderCalls).toHaveLength(0);
});
