import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  browserConnectionHeader,
  browserEventIdSchema,
  browserSubscriptionHeader,
  type BrowserEventFrame,
} from "@ontomato/contracts/browser-events";
import { context, wrap } from "../utils/agent-host";
import type { AgentHostOwner } from "../../services/agent-host/types";
import { HttpError } from "../../utils/errors";

interface Connection {
  owner: AgentHostOwner;
  send(frame: BrowserEventFrame): void;
  subscriptions: Map<string, AbortController>;
}

const connections = new Map<string, Connection>();
export const browserEventsRouter: ReturnType<typeof Router> = Router();

browserEventsRouter.get("/", wrap(async (req, res) => {
  const { owner } = context(req);
  const connectionId = randomUUID();
  const subscriptions = new Map<string, AbortController>();
  connections.set(connectionId, {
    owner,
    subscriptions,
    send: frame => res.write(`data: ${JSON.stringify(frame)}\n\n`),
  });
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  res.once("close", () => {
    clearInterval(heartbeat);
    connections.delete(connectionId);
    for (const subscription of subscriptions.values()) subscription.abort();
  });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    [browserConnectionHeader]: connectionId,
  });
  res.flushHeaders();
}));

function ownedConnection(req: Request) {
  const { owner } = context(req);
  const connectionId = browserEventIdSchema.parse(req.header(browserConnectionHeader));
  const connection = connections.get(connectionId);
  if (!connection || connection.owner.domainId !== owner.domainId || connection.owner.userId !== owner.userId) {
    throw new HttpError(404, "Browser event connection not found", "NOT_FOUND");
  }
  return connection;
}

browserEventsRouter.delete("/:subscriptionId", wrap(async (req, res) => {
  const connection = ownedConnection(req);
  const subscriptionId = browserEventIdSchema.parse(req.params.subscriptionId);
  connection.subscriptions.get(subscriptionId)?.abort();
  res.sendStatus(204);
}));

interface BrowserSubscription {
  signal: AbortSignal;
  open(): void;
  send(data: unknown): void;
}

/** Short HTTP registration. The subscription itself lives until its producer or its browser connection ends. */
export async function publishBrowserEvents(
  req: Request, res: Response, produce: (subscription: BrowserSubscription) => Promise<void>,
): Promise<void> {
  const connection = ownedConnection(req);
  const subscriptionId = browserEventIdSchema.parse(req.header(browserSubscriptionHeader));
  if (connection.subscriptions.has(subscriptionId)) {
    throw new HttpError(409, "Browser event subscription already exists", "SUBSCRIPTION_EXISTS");
  }
  const abort = new AbortController();
  connection.subscriptions.set(subscriptionId, abort);
  let opened = false;
  try {
    await produce({
      signal: abort.signal,
      open() {
        abort.signal.throwIfAborted();
        res.sendStatus(204);
        opened = true;
        connection.send({ type: "subscribed", subscriptionId });
      },
      send(data) {
        if (!abort.signal.aborted) connection.send({ type: "data", subscriptionId, data });
      },
    });
  } catch (error) {
    if (!abort.signal.aborted || error !== abort.signal.reason) throw error;
    if (!opened) res.sendStatus(204);
  } finally {
    if (opened && !abort.signal.aborted) connection.send({ type: "end", subscriptionId });
    abort.abort();
    connection.subscriptions.delete(subscriptionId);
  }
}
