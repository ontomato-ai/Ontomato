/// <reference lib="webworker" />
import {
  browserConnectionHeader, browserEventFrameSchema, browserEventIdSchema, browserEventsPath,
  browserSubscriptionHeader,
} from "@ontomato/contracts/browser-events";
import { randomId } from "@ontomato/contracts/random-id";
import { readSseData } from "@ontomato/contracts/sse";
import type { BrowserEventMessage, BrowserEventRequest } from "./browser-events";

type Refusal = Extract<BrowserEventMessage, { type: "refused" }>;

class RequestRefused extends Error {
  constructor(readonly reply: Refusal) { super(`Browser event request returned HTTP ${reply.status}`); }
}

interface Connection {
  identity: string;
  abort: AbortController;
  ports: Map<string, MessagePort>;
  connectionId: Promise<string>;
}

const scope = self as unknown as SharedWorkerGlobalScope;
let active: Connection | undefined;

function errorMessage(error: unknown): BrowserEventMessage {
  return error instanceof RequestRefused
    ? error.reply
    : { type: "error", message: error instanceof Error ? error.message : String(error) };
}

async function requireSuccess(response: Response) {
  if (response.ok) return;
  throw new RequestRefused({
    type: "refused", status: response.status, headers: [...response.headers], body: await response.text(),
  });
}

function disconnect(connection: Connection, message: BrowserEventMessage) {
  if (active !== connection) return;
  active = undefined;
  connection.abort.abort();
  for (const port of connection.ports.values()) {
    port.postMessage(message);
    port.close();
  }
  connection.ports.clear();
}

function detach(connection: Connection, subscriptionId: string) {
  const port = connection.ports.get(subscriptionId);
  if (!port) return;
  connection.ports.delete(subscriptionId);
  port.close();
  if (connection.ports.size === 0) {
    active = undefined;
    connection.abort.abort();
  }
}

async function openStream(base: string, headers: Headers, signal: AbortSignal) {
  const response = await fetch(`${base}${browserEventsPath}`, { headers, signal, mode: "same-origin", credentials: "omit" });
  await requireSuccess(response);
  return { response, id: browserEventIdSchema.parse(response.headers.get(browserConnectionHeader)) };
}

function connect(identity: string, base: string, headers: Headers): Connection {
  const abort = new AbortController();
  const opened = openStream(base, headers, abort.signal);
  const connection: Connection = {
    identity, abort, ports: new Map(), connectionId: opened.then(({ id }) => id),
  };
  // Each id belongs to exactly one browser port, even for two views of the same run.
  void opened.then(({ response }) => readSseData(response, value => {
    const frame = browserEventFrameSchema.parse(value);
    connection.ports.get(frame.subscriptionId)?.postMessage(frame);
    if (frame.type === "end") detach(connection, frame.subscriptionId);
    return false;
  }, () => !abort.signal.aborted)).then(
    () => disconnect(connection, { type: "error", message: "The shared browser event stream ended" }),
    error => disconnect(connection, errorMessage(error)),
  );
  return connection;
}

function subscribe(request: BrowserEventRequest, port: MessagePort) {
  const { base, path } = request;
  const headers = new Headers(request.headers);
  const identity = JSON.stringify([base, headers.get("tk"), headers.get("x-api-key")]);
  if (active && active.identity !== identity) {
    disconnect(active, { type: "error", message: "The browser event identity changed" });
  }
  const connection = active ??= connect(identity, base, headers);
  const subscriptionId = randomId();
  connection.ports.set(subscriptionId, port);

  const registration = connection.connectionId.then(async id => {
    if (!connection.ports.has(subscriptionId)) return false;
    headers.set(browserConnectionHeader, id);
    headers.set(browserSubscriptionHeader, subscriptionId);
    await requireSuccess(await fetch(`${base}${path}`, {
      method: "POST", headers, signal: connection.abort.signal, mode: "same-origin", credentials: "omit",
    }));
    return true;
  }).catch(error => {
    if (connection.ports.has(subscriptionId)) {
      port.postMessage(errorMessage(error));
      detach(connection, subscriptionId);
    }
    return false;
  });

  port.onmessage = () => {
    detach(connection, subscriptionId);
    void registration.then(async accepted => {
      if (!accepted || connection.abort.signal.aborted) return;
      await requireSuccess(await fetch(`${base}${browserEventsPath}/${subscriptionId}`, {
        method: "DELETE", headers, mode: "same-origin", credentials: "omit",
      }));
    }).catch(error => console.error(error));
  };
}

scope.onconnect = ({ ports: [port] }) => {
  port!.onmessage = ({ data, ports: [reply] }: MessageEvent<BrowserEventRequest>) => subscribe(data, reply!);
};
