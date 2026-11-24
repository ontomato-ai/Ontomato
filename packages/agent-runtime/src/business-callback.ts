import type { Request, Response } from "express";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { runtimeBusinessCallbacksSchema, type RuntimeBusinessCallback } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { runtimeIdSchema, runtimeKeySchema } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeError } from "./errors";
import type { Scope } from "./store";

const callbackName = runtimeBusinessCallbacksSchema.keyof();
type CallbackName = ReturnType<typeof callbackName.parse>;
const sessionPath = "/v1/channel/hosts/:hostId/domains/:domainId/sessions/:sessionId";
export const businessCallbackRoute = sessionPath + "/business/:kind";

export interface BusinessCallbackDispatcher {
  withBusinessCallback(
    scope: Scope, sessionId: string, kind: CallbackName, credential: string | undefined,
    forward: (target: RuntimeBusinessCallback, runId: string, signal: AbortSignal) => Promise<void>,
  ): Promise<void>;
}

export function businessCallbackEnvironment(sessionUrl: string, token: string) {
  const base = sessionUrl + "/business";
  return {
    ONTOMATO_WORKBENCH_URL: base + "/workbench",
    ONTOMATO_URL: base + "/workbench",
    ONTOMATO_ONTOLOGY_URL: base + "/ontology",
    ONTOMATO_PANEL_OPERATIONS_URL: base + "/panelOperations",
    ONTOMATO_AUTHORING_URL: base + "/authoring",
    ONTOMATO_RETRIEVAL_CALLBACK_URL: base + "/retrieval",
    ONTOMATO_GOVERNANCE_WINDOW_URL: base + "/governance",
    // Published skills use this name for their callback header. It carries the session credential.
    ONTOMATO_TK: token,
    ONTOMATO_EXECUTION_CALLBACK: token,
    ONTOMATO_GOVERNANCE_CALLBACK: token,
  };
}

export function matchesBusinessPath(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
}

/** Extend only the declared path; Workbench authorizes the operation and method. */
export async function forwardBusinessCallback(dispatcher: BusinessCallbackDispatcher, req: Request, res: Response) {
  const kind = callbackName.parse(req.params.kind);
  const scope = {
    hostId: runtimeKeySchema.parse(req.params.hostId),
    domainId: runtimeKeySchema.parse(req.params.domainId),
  };
  const sessionId = runtimeIdSchema.parse(req.params.sessionId);
  const token = req.header("X-Ontomato-Callback-Credential") ?? req.header("tk");
  const suffix = req.params[0] as string | undefined;
  const segments = suffix?.split("/") ?? [];
  if (segments.some(part => part === "." || part === ".." || part.includes("%") || part.includes("\\")))
    throw new RuntimeError(400, "INVALID_REQUEST", "Invalid skill callback path");

  await dispatcher.withBusinessCallback(scope, sessionId, kind, token, async (declaration, runId, signal) => {
    const target = new URL(declaration.baseUrl);
    if (segments.length) target.pathname = target.pathname.replace(/\/$/u, "") + "/" + segments.map(encodeURIComponent).join("/");
    if (!matchesBusinessPath(target.pathname, declaration.pathPrefix))
      throw new RuntimeError(403, "FORBIDDEN", "Business callback path is outside the declared scope");
    const queryAt = req.originalUrl.indexOf("?");
    if (queryAt !== -1) target.search = req.originalUrl.slice(queryAt);

    const headers = new Headers({
      [declaration.credentialHeader]: declaration.credential,
      "X-Ontomato-Run-Id": runId,
      "X-Ontomato-Session-Id": sessionId,
    });
    for (const name of ["Accept", "Accept-Language", "Content-Type", "Idempotency-Key"]) {
      const value = req.header(name);
      if (value) headers.set(name, value);
    }

    const client = new AbortController();
    const close = () => client.abort();
    res.once("close", close);
    try {
      const upstream = await fetch(target, {
        method: req.method, headers, redirect: "error",
        body: req.method !== "GET" && Buffer.isBuffer(req.body) ? req.body as Uint8Array<ArrayBuffer> : undefined,
        signal: AbortSignal.any([signal, client.signal]),
      });
      res.status(upstream.status);
      for (const name of ["Content-Type", "Content-Disposition"]) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (upstream.body) {
        res.flushHeaders();
        await pipeline(Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>), res);
      } else {
        res.end();
      }
    } finally {
      res.off("close", close);
    }
  });
}
