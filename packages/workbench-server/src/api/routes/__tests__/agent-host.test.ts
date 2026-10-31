import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
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
  return {
    seen: () => seen.filter((caller) => caller.userId === owner.userId),
    service: {
      agents: async (caller: AgentHostOwner) => (own(caller), { agents: [] }),
      list: async (caller: AgentHostOwner) => (own(caller), { sessions: [view], nextCursor: null }),
      snapshot: async (id: string, caller: AgentHostOwner) => (
        own(caller), { session: { ...view, id }, messages: [], latestRun: null }
      ),
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

beforeAll(async () => {
  installWorkbenchIdentity(identity);
  fake = fakeService();
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
