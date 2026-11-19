import express from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { runtimeSessionRunFrameSchema } from "@ontomato/contracts/agent-runtime-events";
import { agentHostSessionLiveFrameSchema, agentHostSessionRunFrameSchema } from "@ontomato/contracts/agent-host";
import { presentationFrameSchema, type PresentationResult } from "@ontomato/contracts/agent-presentation";
import type {
  AgentHostService,
  AgentHostOwner,
} from "../../../services/agent-host/types";
import type { WorkbenchIdentity } from "../../../identity/types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
import { HttpError } from "../../../utils/errors";
import { createAgentHostRouter } from "../agent-host";
import { publishObjectChanged } from "../../../services/agent-host/presentation";
import { callbackCredential, unwrapCallbackCredential } from "../../../services/agent-runtime/callback-credential";

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
      presentationHost: "workbench",
      ownRun: async (s: string, r: string, caller: AgentHostOwner) => {
        own(caller);
        if (s !== sessionId || r !== runId) throw new HttpError(404, "Run not found", "NOT_FOUND");
      },
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

let server: Server, url: string, observeUrl: string, fake: ReturnType<typeof fakeService>;
let runtimeServer: Server;
let runtimeHeaderCalls: Array<Record<string, string | string[] | undefined>> = [];
let statusCalls: Array<{ sessionIds: string[] }> = [];
let readableCalls: string[][] = [];
let liveRunStreams = false;
const upstreamStreams = new Set<ServerResponse>();
const writeRuntimeFrame = (response: ServerResponse, frame: unknown) =>
  response.write(`data: ${JSON.stringify(frame)}\n\n`);

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
      if (liveRunStreams) {
        upstreamStreams.add(res);
        res.once("close", () => upstreamStreams.delete(res));
        writeRuntimeFrame(res, { type: "ready" });
        return;
      }
      for (const frame of [
        { type: "ready" },
        { type: "run_started", sessionId, runId },
        { type: "run_started", sessionId: foreignSessionId, runId },
        { type: "run_stopped", sessionId, runId },
      ])
        writeRuntimeFrame(res, frame);
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
  app.use(unwrapCallbackCredential);
  app.use((req, _res, next) => {
    // The authentication boundary writes identity; the request body never supplies it.
    const caller = req.header("fixture-auth") ?? (req.header("tk") === "fixture-initiator" ? owner.userId : undefined);
    if (caller) Object.assign(req as AuthenticatedRequest, { domainId: req.header("fixture-domain") ?? owner.domainId, userId: caller });
    next();
  });
  app.use("/api/agent-host", createAgentHostRouter(fake.service));
  app.use("/api/observe/agent", createAgentHostRouter({ ...fake.service, presentationHost: "observe" }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  url = base + "/api/agent-host";
  observeUrl = base + "/api/observe/agent";
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

async function openPresentationStream(viewId = randomUUID(), host = url, headers: Record<string, string> = auth) {
  const abort = new AbortController();
  const response = await fetch(host + "/sessions/run-events?viewId=" + viewId, { headers, signal: abort.signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const nextFrame = async () => {
    while (!buffer.includes("\n\n")) {
      const part = await reader.read();
      if (part.done) throw new Error("Stream ended before the expected frame");
      buffer += decoder.decode(part.value, { stream: true });
    }
    const end = buffer.indexOf("\n\n");
    const [event, data] = buffer.slice(0, end).split("\n");
    buffer = buffer.slice(end + 2);
    return { event: event!.slice("event: ".length), data: JSON.parse(data!.slice("data: ".length)) as unknown };
  };
  const ready = await nextFrame();
  expect(ready.event).toBe("session-run");
  const frame = agentHostSessionRunFrameSchema.parse(ready.data);
  if (frame.type !== "ready" || !("connectionId" in frame)) throw new Error("View stream has no connection identity");
  const upstream = [...upstreamStreams].at(-1)!;
  return {
    viewId, connectionId: frame.connectionId, nextFrame,
    close: async () => {
      const closed = once(upstream, "close");
      abort.abort();
      await closed;
    },
    finish: async () => {
      upstream.end();
      let remaining = buffer;
      for (;;) {
        const message = await reader.read();
        if (message.done) return remaining + decoder.decode();
        remaining += decoder.decode(message.value, { stream: true });
      }
    },
  };
}

function presentationCalls(viewId: string) {
  const runPath = `/sessions/${sessionId}/runs/${runId}`;
  const callbackPath = `${runPath}/presentation-call/${viewId}`;
  const credential = callbackCredential({
    pathPrefix: "/api/agent-host" + callbackPath, runId, expiresAt: Date.now() + 60_000,
    token: "fixture-initiator", apiKey: "",
  }).value;
  const callback = (toolCallId: string) => fetch(url + callbackPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Ontomato-Callback-Credential": credential,
      "X-Ontomato-Run-Id": runId,
    },
    body: JSON.stringify({ toolCallId, input: { target: "/fixture/page" } }),
  });
  const result: PresentationResult = {
    status: "opened", reason: "target_selected", current: {
      known: true, observedAt: new Date().toISOString(), placement: "side",
      target: { kind: "page", url: "/fixture/page", label: "Opened page", selection: [] },
      load: { status: "ready" },
    },
  };
  const receipt = (toolCallId: string, connectionId: string, userId = owner.userId, currentSession = sessionId) =>
    fetch(url + `/sessions/${currentSession}/runs/${runId}/presentation-result`, {
      method: "POST", headers: { ...auth, "fixture-auth": userId },
      body: JSON.stringify({ toolCallId, connectionId, result }),
    });
  return { callback, receipt, result };
}

async function expectPresentation(stream: Awaited<ReturnType<typeof openPresentationStream>>, toolCallId: string) {
  const frame = await stream.nextFrame();
  expect(frame.event).toBe("presentation");
  expect(presentationFrameSchema.parse(frame.data)).toMatchObject({ sessionId, runId, toolCallId });
}

it("sends a live presentation to its bound stream and accepts only the matching receipt before the deadline", async () => {
  liveRunStreams = true;
  try {
    const origin = await openPresentationStream(), other = await openPresentationStream();
    expect(origin.connectionId).not.toBe(other.connectionId);
    const { callback, receipt, result } = presentationCalls(origin.viewId);

    const display = callback("call-1");
    await expectPresentation(origin, "call-1");
    const marker = { type: "run_started", sessionId, runId };
    for (const stream of upstreamStreams) writeRuntimeFrame(stream, marker);
    expect(await other.nextFrame()).toEqual({ event: "session-run", data: marker });
    expect(await origin.nextFrame()).toEqual({ event: "session-run", data: marker });
    expect((await receipt("call-1", origin.connectionId, "bob")).status).toBe(404);
    expect((await receipt("call-1", other.connectionId)).status).toBe(404);
    expect((await receipt("call-1", origin.connectionId, owner.userId, secondSessionId)).status).toBe(404);
    expect((await receipt("call-1", origin.connectionId)).status).toBe(204);
    expect(await (await display).json()).toEqual(result);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Native AbortSignal.timeout uses Node's internal scheduler, which Vitest does not replace.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const timer = new AbortController();
      setTimeout(() => timer.abort(), ms);
      return timer.signal;
    });
    const missing = callback("call-2");
    await expectPresentation(origin, "call-2");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await (await missing).json()).toEqual({
      status: "unknown", reason: "receipt_missing", current: { known: false, reason: "receipt_missing" },
    });
    expect((await receipt("call-2", origin.connectionId)).status).toBe(404);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
    liveRunStreams = false;
    for (const stream of upstreamStreams) stream.end();
  }
});

it("drops offline calls and routes later calls of the same run only to the remounted connection of its view", async () => {
  liveRunStreams = true;
  try {
    const initial = await openPresentationStream();
    const { callback, receipt, result } = presentationCalls(initial.viewId);
    const lost = callback("before-hide");
    await expectPresentation(initial, "before-hide");

    const superseding = await openPresentationStream(initial.viewId);
    expect(superseding.connectionId).not.toBe(initial.connectionId);
    expect((await receipt("before-hide", superseding.connectionId)).status).toBe(404);
    await initial.close();
    expect(await (await lost).json()).toMatchObject({ status: "unknown", reason: "receipt_missing" });

    const resumed = callback("after-replacement");
    await expectPresentation(superseding, "after-replacement");
    expect((await receipt("after-replacement", initial.connectionId)).status).toBe(404);
    expect((await receipt("after-replacement", superseding.connectionId)).status).toBe(204);
    expect(await (await resumed).json()).toEqual(result);

    await superseding.close();
    const refreshed = await openPresentationStream();
    expect(refreshed.viewId).not.toBe(initial.viewId);
    expect(await (await callback("while-hidden")).json()).toMatchObject({
      status: "not_opened", reason: "view_unavailable",
    });

    const returned = await openPresentationStream(initial.viewId);
    const next = callback("after-return");
    await expectPresentation(returned, "after-return");
    expect((await receipt("after-return", returned.connectionId)).status).toBe(204);
    expect(await (await next).json()).toEqual(result);
    expect(await refreshed.finish()).toBe("");
  } finally {
    liveRunStreams = false;
    for (const stream of upstreamStreams) stream.end();
  }
});

it("sends object invalidations only to the initiator's active views in the root session host and domain", async () => {
  liveRunStreams = true;
  try {
    const own = await openPresentationStream(), another = await openPresentationStream();
    const differentUser = await openPresentationStream(randomUUID(), url, { ...auth, "fixture-auth": "bob" });
    const differentDomain = await openPresentationStream(randomUUID(), url, { ...auth, "fixture-domain": "domain-b" });
    const differentHost = await openPresentationStream(randomUUID(), observeUrl);
    const rootSession = { providerId: "workbench", sessionId: secondSessionId };
    const target = { objectType: "platform:ScheduledTask", primaryKey: "job-1" };
    publishObjectChanged({ domainId: owner.domainId, initiator: owner.userId, rootSession, target });
    const affected = { objects: [target], objectTypes: [target.objectType, "platform:MetricView"] };
    publishObjectChanged({ domainId: owner.domainId, initiator: owner.userId, rootSession, target: null, affected });

    for (const stream of [own, another]) {
      const frame = await stream.nextFrame();
      expect(frame.event).toBe("object-changed");
      expect(agentHostSessionLiveFrameSchema.parse(frame.data)).toEqual({ type: "object-changed", session: rootSession, target });
      const batch = await stream.nextFrame();
      expect(batch.event).toBe("object-changed");
      expect(agentHostSessionLiveFrameSchema.parse(batch.data)).toEqual({
        type: "object-changed", session: rootSession, target: null, affected,
      });
    }
    for (const stream of [differentUser, differentDomain, differentHost]) {
      expect(await stream.finish()).toBe("");
    }
  } finally {
    liveRunStreams = false;
    for (const stream of upstreamStreams) stream.end();
  }
});
