import { randomUUID, timingSafeEqual } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import {
  runtimeAdmissionHeadersSchema,
  runtimeServiceHeadersSchema,
  runtimeRequestHeadersSchema,
  runtimeEventSubscriptionSchema,
  runtimeSessionStatusesRequestSchema,
} from "@ontomato/contracts/agent-runtime";
import { runtimeIdSchema } from "@ontomato/contracts/agent-runtime-values";
import { AgentRuntime } from "./runtime";
import { RuntimeError } from "./errors";

export function createRuntimeHttp(runtime: AgentRuntime) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32mb" }));
  const identity = (req: Request) => {
    if (
      typeof req.headers.authorization !== "string" ||
      !/^Bearer \S+$/.test(req.headers.authorization)
    )
      throw new RuntimeError(
        401,
        "UNAUTHENTICATED",
        "Host service credential is required",
      );
    const headers = runtimeServiceHeadersSchema.parse(req.headers);
    const supplied = Buffer.from(headers.authorization.slice(7));
    const host = runtime.options.hosts.find((h) => {
      const expected = Buffer.from(h.token);
      return (
        expected.length === supplied.length &&
        timingSafeEqual(expected, supplied)
      );
    });
    if (!host)
      throw new RuntimeError(
        401,
        "UNAUTHENTICATED",
        "Invalid host service credential",
      );
    return { host, correlationId: headers["x-correlation-id"] };
  };
  const scope = (req: Request) => {
    const { host, correlationId } = identity(req);
    const headers = runtimeRequestHeadersSchema.parse(req.headers);
    return {
      host,
      correlationId,
      scope: { hostId: host.id, domainId: headers["x-domain-id"] },
    };
  };
  const route =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      void fn(req, res).catch(next);
    };
  app.get("/health", (_req, res) => {
    res.json({ status: "ready" });
  });
  app.post(
    "/v1/code-executions",
    route(async (req, res) => {
      const ctx = scope(req),
        headers = runtimeAdmissionHeadersSchema.parse(req.headers);
      res
        .status(202)
        .json(
          await runtime.code.start(
            ctx.host,
            ctx.scope,
            headers["idempotency-key"],
            ctx.correlationId,
            req.body,
          ),
        );
    }),
  );
  app.get(
    "/v1/code-executions/:id",
    route(async (req, res) => {
      res.json(
        await runtime.code.get(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.id),
        ),
      );
    }),
  );
  app.get(
    "/v1/code-executions/:id/outputs/:name",
    route(async (req, res) => {
      res
        .type("text/plain")
        .send(
          await runtime.code.output(
            scope(req).scope,
            runtimeIdSchema.parse(req.params.id),
            req.params.name,
          ),
        );
    }),
  );
  app.post(
    "/v1/code-executions/:id/cancel",
    route(async (req, res) => {
      res.json(
        await runtime.code.cancel(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.id),
        ),
      );
    }),
  );
  app.post(
    "/v1/code-execution-intents/:id/cancel",
    route(async (req, res) => {
      await runtime.code.closeIntent(
        scope(req).scope,
        runtimeIdSchema.parse(req.params.id),
      );
      res.status(204).end();
    }),
  );
  app.post(
    "/v1/skills",
    route(async (req, res) => {
      const { host } = identity(req);
      res
        .status(201)
        .json(
          await runtime.registry.register(
            host,
            typeof req.headers["x-domain-id"] === "string"
              ? req.headers["x-domain-id"]
              : undefined,
            req.body,
          ),
        );
    }),
  );
  app.post(
    "/v1/sessions",
    route(async (req, res) => {
      const ctx = scope(req);
      const headers = runtimeAdmissionHeadersSchema.parse(req.headers);
      z.object({}).strict().parse(req.body);
      res
        .status(201)
        .json(
          await runtime.store.createSession(
            ctx.scope,
            headers["idempotency-key"],
          ),
        );
    }),
  );
  app.post(
    "/v1/sessions/status",
    route(async (req, res) => {
      const ctx = scope(req);
      const { sessionIds } = runtimeSessionStatusesRequestSchema.parse(
        req.body,
      );
      res.json({
        sessions: await runtime.store.sessionStatuses(ctx.scope, sessionIds),
      });
    }),
  );
  app.get(
    "/v1/sessions/:sessionId",
    route(async (req, res) => {
      res.json(
        await runtime.session(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.sessionId),
        ),
      );
    }),
  );
  app.delete(
    "/v1/sessions/:sessionId",
    route(async (req, res) => {
      await runtime.deleteSession(
        scope(req).scope,
        runtimeIdSchema.parse(req.params.sessionId),
      );
      res.status(204).end();
    }),
  );
  app.post(
    "/v1/sessions/:sessionId/runs",
    route(async (req, res) => {
      const ctx = scope(req);
      const headers = runtimeAdmissionHeadersSchema.parse(req.headers);
      res
        .status(202)
        .json(
          await runtime.start(
            ctx.host,
            ctx.scope,
            runtimeIdSchema.parse(req.params.sessionId),
            headers["idempotency-key"],
            ctx.correlationId,
            req.body,
          ),
        );
    }),
  );
  app.get(
    "/v1/runs/:runId",
    route(async (req, res) => {
      res.json(
        await runtime.snapshot(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.runId),
        ),
      );
    }),
  );
  app.post(
    "/v1/sessions/:sessionId/run-intents/:runId/cancel",
    route(async (req, res) => {
      z.object({}).strict().parse(req.body);
      await runtime.closeRunIntent(
        scope(req).scope,
        runtimeIdSchema.parse(req.params.sessionId),
        runtimeIdSchema.parse(req.params.runId),
      );
      res.status(204).end();
    }),
  );
  app.post(
    "/v1/runs/:runId/cancel",
    route(async (req, res) => {
      z.object({}).strict().parse(req.body);
      res.json(
        await runtime.cancel(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.runId),
        ),
      );
    }),
  );
  app.get(
    "/v1/artifacts/:artifactId/content",
    route(async (req, res) => {
      const artifact = await runtime.store.artifact(
        scope(req).scope,
        runtimeIdSchema.parse(req.params.artifactId),
      );
      const bytes = await runtime.files.read(artifact);
      res.setHeader("Content-Type", artifact.mediaType);
      res.setHeader("ETag", `"${artifact.sha256}"`);
      res.setHeader("Content-Length", artifact.size);
      res.send(bytes);
    }),
  );
  app.get(
    "/v1/runs/:runId/artifacts",
    route(async (req, res) => {
      const ctx = scope(req),
        id = runtimeIdSchema.parse(req.params.runId);
      const atSeq =
        req.query.atSeq === undefined
          ? undefined
          : z.coerce.number().int().nonnegative().parse(req.query.atSeq);
      const target =
        req.query.path === undefined
          ? undefined
          : z.string().parse(req.query.path);
      res.json({
        artifacts: await runtime.store.resolveArtifacts(
          ctx.scope,
          id,
          target,
          atSeq,
        ),
      });
    }),
  );
  app.get(
    "/v1/artifacts/:artifactId",
    route(async (req, res) => {
      res.json(
        await runtime.store.artifact(
          scope(req).scope,
          runtimeIdSchema.parse(req.params.artifactId),
        ),
      );
    }),
  );
  app.get(
    "/v1/runs/:runId/events",
    route(async (req, res) => {
      const ctx = scope(req);
      const runId = runtimeIdSchema.parse(req.params.runId);
      const cursor = runtimeEventSubscriptionSchema.parse({
        ...req.query,
        afterSeq: Number(req.query.afterSeq),
      });
      const state = await runtime.store.run(ctx.scope, runId);
      if (cursor.afterSeq > state.seq)
        throw new RuntimeError(
          400,
          "INVALID_REQUEST",
          "Cursor is in the future",
        );
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const timer = setInterval(() => {
        if (!res.destroyed) res.write(": heartbeat\n\n");
      }, 15000);
      timer.unref();
      let closed = false;
      let unsubscribe = () => {};
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
        unsubscribe();
      });
      unsubscribe = await runtime.subscribe(
        ctx.scope,
        runId,
        cursor.afterSeq,
        cursor.streamId,
        (frame) => {
          if (closed) return;
          res.write(
            `${frame.type === "event" ? `id: ${frame.envelope.cursor.seq}\n` : ""}event: runtime\ndata: ${JSON.stringify(frame)}\n\n`,
          );
          if (
            frame.type === "snapshot_required" ||
            frame.envelope.event.type === "agent_end"
          )
            res.end();
        },
      );
      if (closed) unsubscribe();
      if (
        (await runtime.store.run(ctx.scope, runId)).run.status !== "running" &&
        !res.writableEnded
      )
        res.end();
    }),
  );
  app.use((_req, _res, next) =>
    next(new RuntimeError(404, "NOT_FOUND", "Runtime endpoint not found")),
  );
  app.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status =
        error instanceof RuntimeError
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 500;
      const code =
        error instanceof RuntimeError
          ? error.code
          : status === 400
            ? "INVALID_REQUEST"
            : "INTERNAL_ERROR";
      // Never echo validation inputs, provider headers, body-parser text or a stack.
      res.status(status).json({
        error: {
          code,
          message:
            error instanceof RuntimeError
              ? error.message
              : status === 400
                ? "Invalid request"
                : "Runtime request failed",
        },
        correlationId: req.header("x-correlation-id") || randomUUID(),
      });
    },
  );
  return app;
}
