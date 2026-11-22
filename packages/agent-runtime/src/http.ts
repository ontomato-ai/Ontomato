import { agentUserQuestionRequestSchema } from "@ontomato/contracts/agent-user-questions";
import { presentationBindingSchema } from "@ontomato/contracts/agent-presentation";
import { Readable } from "node:stream";
import { agentInputSchema, agentRunContextSchema, agentRefSchema, agentActorRefSchema,agentChannelCommandSchema,agentAuthoritySchema,agentCredentialSchema } from "@ontomato/contracts/agent-channel";
import { workspaceRouter, workspaceOwner } from "./workspace-http";
import { runtimeCreateSessionRequestSchema } from "@ontomato/contracts/agent-runtime";
import { sessionHistoryQuerySchema } from "@ontomato/contracts/session-history";
import { runtimeHistoryQuerySchema } from "@ontomato/contracts/agent-runtime-history";
import { correlationId, withServiceLogContext, updateServiceLogContext, getServiceLogContext, LogQueryError } from "@ontomato/service-logging";
import { serviceLogIdentitySchema } from "@ontomato/contracts/service-logging";
import { runtimeLogger, runtimeDiagnostic } from "./logging";
import { timingSafeEqual } from "node:crypto";
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
  runtimeRunStatusQuerySchema,
} from "@ontomato/contracts/agent-runtime";
import { runtimeIdSchema, runtimeKeySchema } from "@ontomato/contracts/agent-runtime-values";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import type {
  RuntimeSessionRunFrame,
  RuntimeStreamFrame,
} from "@ontomato/contracts/agent-runtime-events";
import { AgentRuntime } from "./runtime";
import { RuntimeError } from "./errors";
import { runtimeEmbeddingsRequestSchema } from "@ontomato/contracts/runtime-embeddings";
import { embedTexts, discoverModels } from "./model-provider";
import { testModel } from "./model";

function readEventSubscription(query: Request["query"]) {
  const { afterSeq } = query;
  return runtimeEventSubscriptionSchema.parse({
    ...query,
    afterSeq: typeof afterSeq === "string" && afterSeq.trim() !== "" ? Number(afterSeq) : afterSeq,
  });
}

export function createRuntimeHttp(runtime: AgentRuntime) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const context = { correlationId: correlationId(req.header("X-Correlation-Id")) };
    res.setHeader("X-Correlation-Id", context.correlationId);
    withServiceLogContext(context, () => {
      const attribution = getServiceLogContext(), started = performance.now();
      res.once("close", () => {
        if (req.path === "/health" || req.path === "/v1/logs") return;
        withServiceLogContext(attribution, () => runtimeLogger.info("request completed", {
          kind: "http", method: req.method, path: req.path, status: res.headersSent ? res.statusCode : null,
          durationMs: Math.floor(performance.now() - started), outcome: !res.writableFinished ? "cancelled" : res.statusCode >= 400 ? "failure" : "success",
        }));
      });
      next();
    });
  });
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
    const user = serviceLogIdentitySchema.safeParse(req.header("X-Ontomato-User-Id"));
    updateServiceLogContext({ correlationId: headers["x-correlation-id"], userId: user.success ? user.data : null });
    for (const [field, header] of [["runId", "X-Ontomato-Run-Id"], ["sessionId", "X-Ontomato-Session-Id"]] as const) {
      const parsed = serviceLogIdentitySchema.safeParse(req.header(header));
      updateServiceLogContext({ [field]: parsed.success ? parsed.data : null });
    }
    return { host, correlationId: headers["x-correlation-id"] };
  };
  const scope = (req: Request) => {
    const { host, correlationId } = identity(req);
    const headers = runtimeRequestHeadersSchema.parse(req.headers);
    updateServiceLogContext({ domainId: headers["x-domain-id"] });
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
  app.use("/v1/workspaces", workspaceRouter(runtime, req => scope(req).scope));
  app.get("/v1/logs", route(async (req, res) => {
    identity(req);
    res.json(await runtime.logs.query(req.query));
  }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ready" });
  });
  app.post("/v1/models/test", route(async (req, res) => {
    const ctx = scope(req);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const { config, prompt } = await runtime.models.testDraft(ctx.scope.domainId, req.body);
    const result = config.kind === "embedding"
      ? { type: "embedding", dimensions: (await embedTexts(config, [prompt], controller.signal, true)).dimensions }
      : await testModel(config, prompt, ctx.correlationId, controller.signal);
    if (!controller.signal.aborted) res.json(result);
  }));
  app.get("/v1/models/migration-map", route(async (req, res) => {
    res.json(await runtime.models.migrationMap(scope(req).scope.domainId));
  }));
  app.post("/v1/models/import-embedding", route(async (req, res) => {
    res.json(await runtime.models.importEmbedding(scope(req).scope.domainId, req.body));
  }));
  app.post("/v1/models/discover", route(async (req, res) => {
    const draft = await runtime.models.discoveryDraft(scope(req).scope.domainId, req.body);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    res.json(await discoverModels(draft, controller.signal));
  }));
  app.post("/v1/models/embeddings", route(async (req, res) => {
    const config = await runtime.models.resolve(scope(req).scope.domainId, null, "embedding");
    const { texts } = runtimeEmbeddingsRequestSchema.parse(req.body);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    res.json(await embedTexts(config, texts, controller.signal));
  }));
  app.get("/v1/models/options", route(async (req, res) => {
    res.json(await runtime.models.options(scope(req).scope.domainId));
  }));
  app.get("/v1/models/settings", route(async (req, res) => {
    res.json(await runtime.models.get(scope(req).scope.domainId));
  }));
  app.put("/v1/models/settings", route(async (req, res) => {
    res.json(await runtime.models.save(scope(req).scope.domainId, req.body));
  }));
  app.get("/v1/mcp/services/names", route(async (req, res) => {
    res.json(await runtime.mcp.options(scope(req).scope));
  }));
  app.get("/v1/mcp/services", route(async (req, res) => {
    res.json({ services: await runtime.mcp.list(scope(req).scope) });
  }));
  app.post("/v1/mcp/services", route(async (req, res) => {
    res.status(201).json({ service: await runtime.mcp.create(scope(req).scope, req.body) });
  }));
  app.put("/v1/mcp/services/:id", route(async (req, res) => {
    res.json({ service: await runtime.mcp.update(scope(req).scope, runtimeIdSchema.parse(req.params.id), req.body) });
  }));
  app.delete("/v1/mcp/services/:id", route(async (req, res) => {
    await runtime.mcp.delete(scope(req).scope, runtimeIdSchema.parse(req.params.id));
    res.status(204).end();
  }));
  app.get("/v1/mcp/services/:id/tools", route(async (req, res) => {
    const ctx = scope(req), id = runtimeIdSchema.parse(req.params.id);
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const tools = await runtime.mcp.discover(ctx.scope, id, ctx.correlationId, controller.signal);
    if (!controller.signal.aborted) res.json({ tools });
  }));
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
  app.get("/v1/history", route(async (req, res) => {
    const ctx = scope(req);
    res.json(await runtime.store.searchHistory(ctx.scope, ctx.host.domainHistory === true,
      runtimeHistoryQuerySchema.parse(req.query)));
  }));
  app.get("/v1/history/:hostId/:runId", route(async (req, res) => {
    const ctx = scope(req);
    res.json(await runtime.store.history(ctx.scope, ctx.host.domainHistory === true,
      req.params.hostId, runtimeIdSchema.parse(req.params.runId)));
  }));
  app.get("/v1/history/:hostId/:runId/artifacts/:artifactId/content", route(async (req, res) => {
    const ctx = scope(req);
    const record = await runtime.store.history(ctx.scope, ctx.host.domainHistory === true,
      req.params.hostId, runtimeIdSchema.parse(req.params.runId));
    const id = runtimeIdSchema.parse(req.params.artifactId);
    const artifact = record.artifacts.find(item => item.id === id);
    if (!artifact) throw new RuntimeError(404, "NOT_FOUND", "Artifact not found");
    res.type(artifact.mediaType).send(await runtime.files.read(artifact));
  }));
  app.post(
    "/v1/sessions",
    route(async (req, res) => {
      const ctx = scope(req);
      const headers = runtimeAdmissionHeadersSchema.parse(req.headers);
      const input = runtimeCreateSessionRequestSchema.parse(req.body);
      res
        .status(201)
        .json(
          await runtime.store.createSession(
            ctx.scope,
            headers["idempotency-key"],
            input.workspaceId,
            input.workspaceId ? workspaceOwner(req) : undefined,
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
    "/v1/sessions/run-events",
    route(async (req, res) => {
      const ctx = scope(req);
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      let closed = false;
      const write = (frame: RuntimeSessionRunFrame) => {
        if (closed || res.writableEnded || res.destroyed) return;
        res.write(`event: session-run\ndata: ${JSON.stringify(frame)}\n\n`);
      };
      const timer = setInterval(() => {
        if (!closed && !res.destroyed && !res.writableEnded)
          res.write(": heartbeat\n\n");
      }, 15000);
      timer.unref();
      // Register before the first frame: `ready` promises that every later change for this
      // host/domain reaches this connection.
      const unsubscribe = runtime.subscribeSessionRuns(ctx.scope, write);
      res.on("close", () => {
        closed = true;
        clearInterval(timer);
        unsubscribe();
      });
    }),
  );
  function gateway(req:Request) {
    const ctx=scope(req);
    if(!ctx.host.channelGateway) throw new RuntimeError(403,"FORBIDDEN","The channel gateway capability is required");
    return ctx;
  }
  async function ownedGatewayTask(req:Request) {
    const ctx=gateway(req),entry=await runtime.channel.facts.task(ctx.scope.domainId,runtimeIdSchema.parse(req.params.taskId));
    if(!entry) throw new RuntimeError(404,"NOT_FOUND","Task not found");
    if(runtimeIdSchema.parse(req.query.actorId)!==entry.intent.channel.actor.id) throw new RuntimeError(403,"FORBIDDEN","Task authorization does not match");
    return {ctx,entry};
  }
  app.post("/v1/channel/hosts/:hostId/domains/:domainId/runs/:runId/commands", route(async (req, res) => {
    const commandScope = {
      hostId: runtimeKeySchema.parse(req.params.hostId),
      domainId: runtimeKeySchema.parse(req.params.domainId),
    };
    const runId = runtimeIdSchema.parse(req.params.runId);
    const sessionHeader = serviceLogIdentitySchema.safeParse(req.header("X-Ontomato-Session-Id"));
    updateServiceLogContext({
      domainId: commandScope.domainId,
      runId,
      sessionId: sessionHeader.success ? sessionHeader.data : null,
    });
    res.json(await runtime.runChannelCommand(
      commandScope,
      runId,
      req.header("X-Ontomato-Callback-Credential"),
      req.header("X-Ontomato-Run-Id"),
      req.header(BUILD_TEST_HEADER),
      req.body,
    ));
  }));
  app.post("/v1/channel/commands",route(async(req,res)=>{
    const ctx=gateway(req),body=z.object({command:agentChannelCommandSchema,actor:agentActorRefSchema,authority:agentAuthoritySchema,language:z.string().min(1),credential:agentCredentialSchema}).strict().parse(req.body);
    if(body.actor.domainId!==ctx.scope.domainId) throw new RuntimeError(403,"CROSS_DOMAIN","Actor belongs to another domain");
    res.json(await runtime.channel.execute(ctx.scope,{kind:"external",actor:body.actor,authority:body.authority,language:body.language,credential:body.credential},body.command));
  }));
  app.get("/v1/channel/tasks/:taskId/actor",route(async(req,res)=>{
    const ctx=gateway(req),entry=await runtime.channel.facts.task(ctx.scope.domainId,runtimeIdSchema.parse(req.params.taskId));
    if(!entry) throw new RuntimeError(404,"NOT_FOUND","Task not found");
    res.json({actor:entry.intent.channel.actor});
  }));
  app.get("/v1/channel/providers/:providerId/sessions/:sessionId/actor",route(async(req,res)=>{
    const ctx=gateway(req),ref={providerId:z.string().min(1).parse(req.params.providerId),sessionId:runtimeIdSchema.parse(req.params.sessionId)};
    res.json({actor:(await runtime.channel.facts.binding(runtime.channel.scope(ref,ctx.scope.domainId),ref.sessionId)).actor});
  }));
  app.get("/v1/channel/tasks/:taskId/events",route(async(req,res)=>{
    const {ctx,entry}=await ownedGatewayTask(req);
    res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"});res.flushHeaders();
    let closed=false,queue=Promise.resolve();
    const send=()=>{queue=queue.then(async()=>{
      if(closed) return;
      const task=await runtime.channel.execute(ctx.scope,{kind:"external",actor:entry.intent.channel.actor,authority:{classNames:[],executionKind:"live"},language:entry.intent.language,credential:{token:null,apiKey:null}},{op:"read",taskId:entry.intent.id});
      if(!closed) res.write(`event: task\ndata: ${JSON.stringify({type:"task_snapshot",task})}\n\n`);
    }).catch(error=>{if(!closed){res.write(`event: task\ndata: ${JSON.stringify({type:"error",error:{code:error instanceof RuntimeError?error.code:"INTERNAL_ERROR",message:error instanceof Error?error.message:"Task projection failed"}})}\n\n`);res.end();}});};
    const detach=runtime.channel.subscribe(entry.scope,entry.intent.session.sessionId,send);send();
    const timer=setInterval(()=>res.write(": heartbeat\n\n"),15000);timer.unref();
    res.on("close",()=>{closed=true;clearInterval(timer);detach();});
  }));
  app.get("/v1/channel/tasks/:taskId/files/:fileId",route(async(req,res)=>{
    const {entry}=await ownedGatewayTask(req),response=await runtime.channel.file(entry.intent,runtimeIdSchema.parse(req.params.fileId));
    res.type(response.headers.get("content-type") || "application/octet-stream");
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(res);
  }));
  app.get("/v1/channel/sessions/:sessionId/intents/:runId",route(async(req,res)=>{
    const ctx=scope(req),sessionId=runtimeIdSchema.parse(req.params.sessionId),intent=await runtime.channel.facts.intent(ctx.scope,runtimeIdSchema.parse(req.params.runId));
    if(intent.session.sessionId!==sessionId) throw new RuntimeError(404,"NOT_FOUND","Execution intent not found");
    res.json(intent);
  }));
  app.post("/v1/channel/runs/:runId/stop-model",route(async(req,res)=>{
    const ctx=scope(req);z.object({}).strict().parse(req.body);
    await runtime.channel.stopModel(ctx.scope,runtimeIdSchema.parse(req.params.runId));res.json({accepted:true});
  }));
  app.post("/v1/channel/runs/:runId/changed",route(async(req,res)=>{
    const ctx=scope(req),body=z.object({kind:z.enum(["delivery","quality","progress"])}).strict().parse(req.body);
    await runtime.channel.changed(ctx.scope,runtimeIdSchema.parse(req.params.runId),body.kind);
    res.json({accepted:true});
  }));
  app.post("/v1/channel/sessions/:sessionId/workspace", route(async (req, res) => {
    const ctx = scope(req), id = runtimeIdSchema.parse(req.params.sessionId);
    const { workspaceId, ownerId } = z.object({ workspaceId: runtimeIdSchema, ownerId: z.string().min(1) }).strict().parse(req.body);
    await runtime.workspaces.get(ctx.scope, ownerId, workspaceId);
    const result = await runtime.store.pool.query(`UPDATE ${runtime.store.table("sessions")} SET workspace_id=$4 WHERE host_id=$1 AND domain_id=$2 AND id=$3 AND (workspace_id IS NULL OR workspace_id=$4) AND active_run_id IS NULL RETURNING id`, [ctx.scope.hostId,ctx.scope.domainId,id,workspaceId]);
    if (!result.rowCount) throw new RuntimeError(409,"WORKSPACE_CHANGED","Session workspace cannot change");
    res.json({ accepted: true });
  }));
  app.get("/v1/channel/sessions/:sessionId/tasks/:taskId/process", route(async (req, res) => {
    const target = await runtime.channel.process(scope(req).scope, runtimeIdSchema.parse(req.params.sessionId), runtimeIdSchema.parse(req.params.taskId));
    res.json(await runtime.snapshot(target.scope, target.runId));
  }));
  app.get("/v1/channel/sessions/:sessionId/tasks/:taskId/process/events", route(async (req, res) => {
    const target = await runtime.channel.process(scope(req).scope, runtimeIdSchema.parse(req.params.sessionId), runtimeIdSchema.parse(req.params.taskId));
    const after = readEventSubscription(req.query);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" }); res.flushHeaders();
    const detach = await runtime.subscribe(target.scope, target.runId, after.afterSeq, after.streamId, frame => res.write(`event: runtime\ndata: ${JSON.stringify(frame)}\n\n`));
    const timer = setInterval(() => res.write(": heartbeat\n\n"),15000); timer.unref();
    res.on("close", () => { clearInterval(timer); detach(); });
  }));
  app.post("/v1/channel/sessions/:sessionId/bind", route(async (req, res) => {
    const ctx = scope(req), id = runtimeIdSchema.parse(req.params.sessionId);
    const body = z.object({ agent: agentRefSchema, actor: agentActorRefSchema }).strict().parse(req.body);
    if (ctx.scope.domainId !== body.actor.domainId || runtime.channel.provider(body.agent.providerId).hostId !== ctx.scope.hostId) throw new RuntimeError(403, "CROSS_DOMAIN", "Caller and provider must belong to this scope");
    await runtime.store.session(ctx.scope,id);
    const previous = (await runtime.store.pool.query(`SELECT channel FROM ${runtime.store.table("sessions")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [ctx.scope.hostId,ctx.scope.domainId,id])).rows[0].channel;
    await runtime.channel.facts.bind(ctx.scope, id, { ...body, parent: previous?.parent ?? null });
    res.json({ accepted: true });
  }));
  app.post("/v1/channel/user-questions", route(async (req,res) => {
    const ctx = scope(req), headers = runtimeAdmissionHeadersSchema.parse(req.headers);
    res.status(201).json(await runtime.channel.userQuestion(ctx.scope,headers["idempotency-key"],agentUserQuestionRequestSchema.parse(req.body)));
  }));
  app.get("/v1/channel/user-questions/:questionId/answers/:answerId",route(async(req,res) => {
    res.json(await runtime.channel.facts.userAnswer(scope(req).scope,runtimeIdSchema.parse(req.params.questionId),runtimeIdSchema.parse(req.params.answerId)));
  }));
  app.post("/v1/channel/sessions/:sessionId/runs", route(async (req, res) => {
    const ctx = scope(req), headers = runtimeAdmissionHeadersSchema.parse(req.headers);
    const body = z.object({ channel: agentRunContextSchema, language: z.string().min(1), input: agentInputSchema, replyTo: runtimeIdSchema.optional(), selectedOption: z.number().int().nonnegative().optional(), credential: agentCredentialSchema.optional(), credentialFrom: runtimeIdSchema.optional(), context: z.record(z.unknown()).optional(), presentationBinding: presentationBindingSchema.optional() }).strict().parse(req.body);
    if (Boolean(body.credential) === Boolean(body.credentialFrom)) throw new RuntimeError(400,"INVALID_REQUEST","Provide exactly one initiating credential or source execution");
    const entry = body.credentialFrom ? await runtime.channel.facts.task(ctx.scope.domainId,body.credentialFrom) : null;
    if(body.credentialFrom && !entry)throw new RuntimeError(404,"NOT_FOUND","Source execution not found");
    if(entry && entry.scope.hostId!==ctx.scope.hostId && !ctx.host.channelGateway)throw new RuntimeError(403,"FORBIDDEN","Cross-provider admission requires the channel gateway");
    const source=entry?.intent;
    const channel = source ? {...body.channel,root:source.channel.root,userRecipient:source.channel.userRecipient ?? null} : body.channel;
    const credential = body.credential ?? runtime.channel.credential(source!.channel);
    res.status(202).json(await runtime.channel.request(ctx.scope, runtimeIdSchema.parse(req.params.sessionId), headers["idempotency-key"], channel, body.replyTo ? {role:"notification",kind:"agent-answer",source:{kind:"user"},content:body.input.content,timestamp:body.input.timestamp,replyTo:body.replyTo,selectedOption:body.selectedOption,respondent:channel.actor} : body.input, body.language, body.context as import("@ontomato/contracts/agent-channel").AgentRunIntent["context"], credential, source?.executionUserId, source ? undefined : body.presentationBinding));
  }));
  app.get("/v1/channel/sessions/:sessionId/tasks", route(async (req, res) => {
    res.json(await runtime.channel.tasks(scope(req).scope, runtimeIdSchema.parse(req.params.sessionId)));
  }));
  app.get("/v1/channel/sessions/:sessionId/events", route(async (req, res) => {
    const ctx = scope(req), sessionId = runtimeIdSchema.parse(req.params.sessionId);
    await runtime.store.session(ctx.scope, sessionId);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" }); res.flushHeaders();
    let closed = false, queue = Promise.resolve();
    const send = () => { queue = queue.then(async () => { if (closed) return; const snapshot = await runtime.channel.tasks(ctx.scope, sessionId); if (!closed) res.write(`event: tasks\ndata: ${JSON.stringify({ ...snapshot, type: "tasks_snapshot", settled: false })}\n\n`); }).catch(error => { runtimeLogger.error("Channel projection failed", runtimeDiagnostic(error)); res.destroy(error); }); };
    const detach = runtime.channel.subscribe(ctx.scope, sessionId, send);
    res.write('event: ready\ndata: {"type":"ready"}\n\n'); send();
    const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000); timer.unref();
    res.on("close", () => { closed = true; clearInterval(timer); detach(); });
  }));
  app.get("/v1/sessions/:sessionId/history", route(async (req, res) => {
    res.json(await runtime.history(scope(req).scope, runtimeIdSchema.parse(req.params.sessionId), sessionHistoryQuerySchema.parse(req.query)));
  }));
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
  app.get("/v1/runs/:runId/final-reply", route(async (req, res) => {
    res.json(await runtime.store.finalReply(scope(req).scope, runtimeIdSchema.parse(req.params.runId)));
  }));
  app.get(
    "/v1/runs/:runId/status",
    route(async (req, res) => {
      const query = runtimeRunStatusQuerySchema.parse(req.query);
      const gone = new AbortController();
      res.on("close", () => gone.abort());
      const run = await runtime.runStatus(
        scope(req).scope,
        runtimeIdSchema.parse(req.params.runId),
        query.waitFor ? { timeoutMs: query.timeoutMs ?? 30000, signal: gone.signal } : undefined,
      );
      if (!res.writableEnded && !gone.signal.aborted) res.json({ run });
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
      const checkOtherRuns = z.literal("true").optional().parse(req.query.checkOtherRuns);
      const artifacts = await runtime.store.resolveArtifacts(ctx.scope, id, target, atSeq);
      const samePathInAnotherRun = checkOtherRuns && target !== undefined && atSeq === undefined
        && !artifacts.some(artifact => artifact.runId === id)
        ? await runtime.store.hasArtifactInAnotherRun(ctx.scope, id, target)
        : undefined;
      res.json({ artifacts, ...(samePathInAnotherRun && { samePathInAnotherRun }) });
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
      const cursor = readEventSubscription(req.query);
      const state = await runtime.store.run(ctx.scope, runId);
      if (cursor.afterSeq > state.seq)
        throw new RuntimeError(
          400,
          "INVALID_REQUEST",
          "Cursor is in the future",
        );
      // Subscribe before any header is sent: a rejected subscription must stay an HTTP error rather
      // than an empty 200 stream. Frames arriving before the stream opens are buffered in order.
      const buffered: RuntimeStreamFrame[] = [];
      let open = false;
      let closed = false;
      let unsubscribe = () => {};
      let timer: ReturnType<typeof setInterval> | undefined;
      const write = (frame: RuntimeStreamFrame) => {
        if (closed || res.writableEnded || res.destroyed) return;
        res.write(
          `${frame.type === "event" ? `id: ${frame.envelope.cursor.seq}\n` : ""}event: runtime\ndata: ${JSON.stringify(frame)}\n\n`,
        );
        if (
          frame.type === "snapshot_required" ||
          frame.envelope.event.type === "agent_end"
        ) {
          // Stop the heartbeat before ending the response. Otherwise the timer can fire between
          // end() and the socket close event, writing after end and crashing the runtime with
          // ERR_STREAM_WRITE_AFTER_END.
          closed = true;
          if (timer) clearInterval(timer);
          unsubscribe();
          res.end();
        }
      };
      res.on("close", () => {
        closed = true;
        if (timer) clearInterval(timer);
        unsubscribe();
      });
      unsubscribe = await runtime.subscribe(
        ctx.scope,
        runId,
        cursor.afterSeq,
        cursor.streamId,
        (frame) => {
          if (open) write(frame);
          else buffered.push(frame);
        },
      );
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      timer = setInterval(() => {
        if (!closed && !res.destroyed && !res.writableEnded)
          res.write(": heartbeat\n\n");
      }, 15000);
      timer.unref();
      open = true;
      for (const frame of buffered) write(frame);
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
      if ((error as { code?: string }).code === "55P03")
        error = new RuntimeError(409, "WORKSPACE_BUSY", "Workspace is being modified");
      const status =
        (error instanceof RuntimeError || error instanceof LogQueryError)
          ? error.status
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : 500;
      const code =
        (error instanceof RuntimeError || error instanceof LogQueryError)
          ? error.code
          : status === 400
            ? req.path === "/v1/logs" ? "INVALID_LOG_QUERY" : "INVALID_REQUEST"
            : req.path === "/v1/logs" ? "LOG_QUERY_FAILED" : "INTERNAL_ERROR";
      if (status >= 500 && !(error instanceof LogQueryError)) runtimeLogger.error("request failed", runtimeDiagnostic(error));
      // Never echo validation inputs, provider headers, body-parser text or a stack.
      res.status(status).json({
        error: {
          code,
          message:
            (error instanceof RuntimeError || error instanceof LogQueryError)
              ? error.message
              : status === 400
                ? "Invalid request"
                : "Runtime request failed",
        },
        correlationId: getServiceLogContext().correlationId,
      });
    },
  );
  return app;
}
