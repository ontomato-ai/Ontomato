import { closeGovernanceWindow, requireGovernanceAccess } from "./governance";
import { needsRetrievalScope, hasGovernanceSkill } from "./skills";
import { agentHostSendResultSchema, type AgentHostSendRequest } from "@ontomato/contracts/agent-host";
import { resolveLocale } from "../../i18n";
import { assertAppBuilderAccess } from "../app-builder/access";
import { ChannelProcessClient } from "../agent-host/process";
import { agentProfileForPrincipal } from "../product-assets/agent-profile";
import { assistantOntologyContext } from "./context";
import { openAgentCaller } from "../agent-host/caller";
import type { AgentPrepareRequest, AgentRunContext } from "@ontomato/contracts/agent-channel";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { prepareAnalystRun } from "./prepare";
import { prepareAppBuilderRun } from "../app-builder/prepare";
import {isAppBuilderKind} from '../app-builder/definition';
import type { SessionHistoryQuery } from "@ontomato/contracts/session-history";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assistantFeedbackSchema,
  type AssistantFeedbackWrite,
} from "@ontomato/contracts/assistant-chat";
import { agentHostSessionSchema } from "@ontomato/contracts/agent-host";
import { listAssistantAgents } from "./agents";
import {
  runtimeArtifactSchema,
  type RuntimeArtifact,
} from "@ontomato/contracts/agent-runtime-artifacts";
import {
  datasetPayloadSchema,
} from "@ontomato/contracts/data-retrieval";
import { pageDraftSchema } from "@ontomato/contracts/page-draft";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { withDomainSkills } from "../skills/operations";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { assistantStore, type AssistantOwner, type SessionRow, type TurnRow } from "./store";
import {
  messageText,
  type AssistantCredentials,
} from "../../platform/agent-runtime/runtime";
import { OntologyRetrievalClient } from "./ontology-retrieval";
import { agentTasksSnapshotSchema, type AgentTasksSnapshot } from "@ontomato/contracts/agent-tasks";
import { transaction } from "../../infrastructure/postgres-transaction";
import { HttpError } from "../../utils/errors";
import { createLogger } from "../../logging/logger";
const db = () => getPostgresPool(),
  logger = createLogger("assistant"),
  // Longer than any start() takes to admit a run, so an unadmitted turn older than this is not still starting.
  ADMISSION_GRACE_MS = 10 * 60_000,
  RECONCILE_PAGE = 200;
export { publicSnapshot } from "../../platform/agent-runtime/projection";
import { publicMessages, publicSnapshot, publicRun, runStatusView } from "../../platform/agent-runtime/projection";
type LatestRun = Parameters<typeof runStatusView>[0];
const sessionView = (s: SessionRow, latestRun: LatestRun | null) =>
  agentHostSessionSchema.parse({
    id: s.id,
    agentId: s.agent_id,
    title: s.title,
    workspaceId: s.workspace_id,
    createdAt: new Date(s.created_at).toISOString(),
    updatedAt: new Date(s.updated_at).toISOString(),
    latestRun: latestRun ? runStatusView(latestRun) : null,
    origin: s.origin,
  });
export { sessionView };
export const assistantService = {
  async isAppBuilder(owner: AssistantOwner, input: { agentId: string } | { sessionId: string }) {
    const agentId = "agentId" in input ? input.agentId : (await assistantStore.session(input.sessionId, owner)).agent_id;
    return isAppBuilderKind((await assistantStore.agent(agentId, owner)).kind);
  },
  agents: listAssistantAgents,
  /** Scheduled tasks start their conversations here too, marked with their origin. */
  async create(id: string, owner: AssistantOwner, input: { agentId: string; workspaceId?: string }, origin: SessionRow["origin"] = "user") {
    const { row, replayed } = await assistantStore.create(
      id,
      owner,
      input.agentId,
      origin,
      input.workspaceId,
    );
    try {
      await new RuntimeClient(owner.domainId, undefined, owner.userId).createSession(id, input.workspaceId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 410) {
        await db().query(
          `DELETE FROM ${table("assistant_sessions")} WHERE id=$1`,
          [id],
        );
        throw new HttpError(404, "Conversation not found", "NOT_FOUND");
      }
      throw e;
    }
    const latestRun = (await new RuntimeClient(owner.domainId, undefined, owner.userId).session(id))
      .latestRun;
    return { session: sessionView(row, latestRun?.run ?? null), replayed };
  },
  async list(
    owner: AssistantOwner,
    input: {
      agentId?: string;
      workspaceId?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    let cursor = null;
    if (input.cursor) {
      try {
        cursor = z
          .object({
            updatedAt: z.string().datetime(),
            id: z.string().uuid(),
            agentId: z.string().optional(),
            workspaceId: z.string().optional(),
          })
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      } catch {
        throw new HttpError(400, "Invalid session cursor", "INVALID_REQUEST");
      }
    }
    if (cursor && (cursor.agentId !== input.agentId || cursor.workspaceId !== input.workspaceId))
      throw new HttpError(400, "Cursor filters differ");
    const rows = (
      await db().query(
        `SELECT * FROM ${table("assistant_sessions")} WHERE domain_id=$1 AND owner_id=$2 AND ($3::uuid IS NULL OR agent_id=$3) AND ($7::uuid IS NULL OR workspace_id=$7) AND ($4::timestamptz IS NULL OR (updated_at,id)<($4,$5::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $6`,
        [
          owner.domainId,
          owner.userId,
          input.agentId ?? null,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          input.limit + 1,
          input.workspaceId ?? null,
        ],
      )
    ).rows as SessionRow[];
    const selected = rows.slice(0, input.limit);
    // One status read per page: a row names its latest run, and the run's body is only read by
    // the history call that opens the conversation.
    const statuses = selected.length
      ? await new RuntimeClient(owner.domainId, undefined, owner.userId).sessionStatuses(
          selected.map((row) => row.id),
        )
      : [];
    const sessions = selected.map((row) =>
      sessionView(
        row,
        statuses.find((s) => s.session.id === row.id)?.latestRun ?? null,
      ),
    );
    const last = selected.at(-1);
    return {
      sessions,
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(
              JSON.stringify({
                updatedAt: new Date(last.updated_at).toISOString(),
                id: last.id,
                agentId: input.agentId,
                workspaceId: input.workspaceId,
              }),
            ).toString("base64url")
          : null,
    };
  },
  async readableSessions(owner: AssistantOwner, ids: string[]) {
    return assistantStore.readableSessions(owner, ids);
  },
  async history(id: string, owner: AssistantOwner, query: SessionHistoryQuery) {
    await assistantStore.session(id, owner);
    const page = await new RuntimeClient(owner.domainId, undefined, owner.userId).history(id, query);
    return { ...page, session: sessionView(await assistantStore.session(id, owner), page.session.latestRun) };
  },
  async snapshot(id: string, owner: AssistantOwner) {
    const row = await assistantStore.session(id, owner),
      s = await new RuntimeClient(owner.domainId, undefined, owner.userId).session(id);
    return {
      session: sessionView(await assistantStore.session(row.id, owner), s.latestRun?.run ?? null),
      pendingQuestions: s.pendingQuestions,
      messages: publicMessages(s.messages),
      latestRun: s.latestRun ? publicSnapshot(s.latestRun) : null,
    };
  },
  /** The run belongs to this user's session by the workbench's own turn record; no runtime read is needed. */
  async ownRun(sessionId: string, id: string, owner: AssistantOwner) {
    const turn = await assistantStore.turn(id, owner);
    if (turn.session_id !== sessionId)
      throw new HttpError(404, "Run not found");
  },
  async readRun(sessionId: string, id: string, owner: AssistantOwner) {
    await this.ownRun(sessionId, id, owner);
    return new RuntimeClient(owner.domainId, undefined, owner.userId).run(id);
  },
  /**
   * The conversation's delegated work: each admitted turn's caller scope names the rounds and quality checks the
   * ontology service ran for that reply, so the turn's run is their root. Settled while nothing will change before the
   * conversation's next run: the latest turn has been settled and the ontology service owes nothing.
   */
  async tasks(sessionId:string,owner:AssistantOwner,supplied?:AgentTasksSnapshot) {
    await assistantStore.session(sessionId,owner);
    return {snapshot:supplied ?? await this.channelTasks(sessionId,owner),settled:false};
  },
  async channelTasks(sessionId: string, owner: AssistantOwner) {
    return agentTasksSnapshotSchema.parse(await new RuntimeClient(owner.domainId, undefined, owner.userId).request(`/v1/channel/sessions/${sessionId}/tasks`));
  },
  /** A retrieval task's own run, through the caller scope of the reply that delegated it. */
  async taskProcess(sessionId:string,taskId:string,owner:AssistantOwner) {
    const task=(await this.tasks(sessionId,owner)).snapshot.tasks.find(task=>task.id===taskId);
    if(task?.kind!=="agent" || task.process.mode!=="inline") throw new HttpError(404,"Task process not found","NOT_FOUND");
    return {client:new ChannelProcessClient(owner,sessionId,taskId),process:task.process};
  },
  /** Parent completion records its own turn only; delegated executions retain their authorization. */
  async settleTurn(id: string, owner: AssistantOwner) { await closeGovernanceWindow(id,owner); await assistantStore.settled(id); },
  async cancelScope(id: string,owner: AssistantOwner,credentials: AssistantCredentials) {
    await closeGovernanceWindow(id,owner);
    const turn=await assistantStore.turn(id,owner);
    if (turn.retrieval_scope_id) await new OntologyRetrievalClient(owner,turn.retrieval_scope_id).closeScope(credentials);
    await assistantStore.settled(id);
  },
  async prepare(body: AgentPrepareRequest, owner: AssistantOwner, credentials: AssistantCredentials): Promise<RuntimeStartRunRequest> {
    const { sessionId, runId: id, input, authority } = body;
    try {
      const { agent: a, ontologyContext } = await this.admitAgent(body.agent.agentId,owner,credentials,authority);
      const context = isAppBuilderKind(a.kind) ? z.object({ workspaceId: z.string().uuid() }).strict().safeParse(body.context) : null;
      if (context && !context.success) throw new HttpError(400,"App builder requires context.workspaceId containing an owned workspace UUID","CONTEXT_REQUIRED");
      const workspace = context?.success ? context.data.workspaceId : undefined;
      if (workspace) await new RuntimeClient(owner.domainId,undefined,owner.userId).request(`/v1/channel/sessions/${sessionId}/workspace`,"POST",{ workspaceId: workspace,ownerId: owner.userId });
      const { row: session } = await assistantStore.create(sessionId,owner,a.id,"delegated",workspace);
      const message = input.content;
      const { row: turn } = await assistantStore.reserve(sessionId,id,message,owner,a.class_names);
      const request = await withDomainSkills(owner.domainId,async () => {
        const prepare = isAppBuilderKind(a.kind) ? prepareAppBuilderRun : prepareAnalystRun;
        return prepare({ a,session,turn,message,input,inputId:body.inputId,ontologyContext,owner,credentials });
      });
      await assistantStore.admitted(id,message);
      return { ...request,input,authority: { classNames: a.class_names,executionKind: isAppBuilderKind(a.kind) ? "build-test" : "live" } };
    } catch (error) {
      await closeGovernanceWindow(id,owner);
      throw error;
    }
  },
  async admitAgent(id: string, owner: AssistantOwner, credentials: AssistantCredentials, authority?: AgentRunContext["authority"]) {
    const a = await assistantStore.agent(id,owner);
    if (!a.enabled) throw new HttpError(409,"Agent disabled","AGENT_DISABLED");
    if (authority?.executionKind === "build-test" && !isAppBuilderKind(a.kind)) throw new HttpError(403,"Build-test runs cannot delegate to a live agent","BUILD_TEST_FORBIDDEN");
    if (authority?.classNames.length) {
      a.class_names = a.class_names.length ? a.class_names.filter(name => authority.classNames.includes(name)) : authority.classNames;
      if (!a.class_names.length) throw new HttpError(403,"No authorized classes in the delegated scope","FORBIDDEN");
    }
    if (isAppBuilderKind(a.kind)) await assertAppBuilderAccess(credentials);
    if (hasGovernanceSkill(a.skills)) await requireGovernanceAccess(owner,credentials);
    const {nativeProfileId}=await import('../product-assets/platform-assets');
    const native=await nativeProfileId(owner.domainId,a.id);
    if(native){const {requireProductUse}=await import('../product-assets/grants');await requireProductUse(owner,native);await requireProductUse(owner,a.id);if(!credentials.token?.startsWith('ap2.')){const {userScopedAgentCredentials}=await import('../product-assets/agent-principal');credentials=await userScopedAgentCredentials(owner.domainId,a.id,owner.userId,credentials.locale);}}
    const profile = isAppBuilderKind(a.kind)||native ? null : await agentProfileForPrincipal(owner,credentials,a.id);
    const ontologyContext = isAppBuilderKind(a.kind) || profile || !needsRetrievalScope(a.skills) ? null : await assistantOntologyContext(a,credentials);
    return { agent: a,ontologyContext };
  },
  async send(sessionId: string, id: string, input: AgentHostSendRequest, owner: AssistantOwner, credentials: AssistantCredentials) {
    const session = await assistantStore.session(sessionId, owner), a = await assistantStore.agent(session.agent_id, owner);
    const {nativeProfileId}=await import('../product-assets/platform-assets');const native=await nativeProfileId(owner.domainId,a.id);
    if(native){const {requireProductUse}=await import('../product-assets/grants');await requireProductUse(owner,native);await requireProductUse(owner,a.id);const {userScopedAgentCredentials}=await import('../product-assets/agent-principal');credentials=await userScopedAgentCredentials(owner.domainId,a.id,owner.userId,credentials.locale);}
    const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
    const actor = await openAgentCaller(owner, credentials), agent = { providerId: "workbench", agentId: session.agent_id };
    await client.request(`/v1/channel/sessions/${sessionId}/bind`, "POST", { agent, actor });
    const channel: AgentRunContext = { agent, actor, authority: { classNames: a.class_names, executionKind: isAppBuilderKind(a.kind) ? "build-test" : "live" }, requestedBy: null, root: { session: { providerId: "workbench", sessionId }, runId: id } };
    const accepted = agentHostSendResultSchema.omit({snapshot:true}).parse(await client.request(`/v1/channel/sessions/${sessionId}/runs`, "POST", { channel, credential: {token:credentials.token ?? null,apiKey:credentials.apiKey ?? null}, language: resolveLocale(credentials.locale), input: { role: "user", content: input.message, timestamp: Date.now() }, replyTo: input.replyTo, ...(session.workspace_id ? { context: { workspaceId: session.workspace_id } } : {}) }, id));
    return agentHostSendResultSchema.parse({ ...accepted, snapshot: accepted.delivery.delivery === "run" && accepted.delivery.status === "running" ? publicSnapshot(await client.run(accepted.delivery.runId)) : null });

  },
  /**
   * The one place a turn is finished after it ends, and repaired after a lost start response: walks every
   * unsettled turn, reads the runtime's lifecycle view and leaves running ones for the next pass.
   * Idempotent across instances.
   */
  async reconcile(now = Date.now()) {
    let after: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const page = await assistantStore.unsettled(RECONCILE_PAGE, after);
      for (const turn of page) await this.reconcileTurn(turn, now);
      if (page.length < RECONCILE_PAGE) return;
      after = { createdAt: page.at(-1)!.created_at, id: page.at(-1)!.id };
    }
  },
  async reconcileTurn(turn: TurnRow & AssistantOwner, now: number) {
    const owner = { domainId: turn.domainId, userId: turn.userId },
      client = new RuntimeClient(owner.domainId, undefined, owner.userId);
    try {
      let view;
      try {
        view = await client.status(turn.id);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      if (!turn.admitted) {
        // start() may still be admitting it; past the grace period it either reached the runtime or never will.
        if (now - new Date(turn.created_at).getTime() < ADMISSION_GRACE_MS) return;
        if (view) {
          const s = await client.run(turn.id);
          await assistantStore.admitted(turn.id, messageText(
            s.messages.find((m) => m.message.role === "user")?.message ?? { content: "" },
          ));
        } else {
          // Blocks a late admission; a runtime that has no such session cannot admit it either.
          try {
            await client.request(`/v1/sessions/${turn.session_id}/run-intents/${turn.id}/cancel`, "POST", {});
          } catch (e) {
            if (!(e instanceof HttpError && e.status === 404)) throw e;
          }
        }
      }
      if (!view || view.status === "stopped") await this.settleTurn(turn.id,owner);
    } catch (e) {
      logger.warn("Assistant turn reconciliation failed", {
        runId: turn.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  async cancel(
    sessionId: string,
    id: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    await assistantStore.session(sessionId, owner);
    const existing = (
      await db().query(
        `SELECT session_id FROM ${table("assistant_turns")} WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (existing) {
      const turn = await assistantStore.turn(id, owner);
      if (turn.session_id !== sessionId)
        throw new HttpError(404, "Run not found");
    } else {
      let runtime;
      try {
        runtime = await new RuntimeClient(owner.domainId, undefined, owner.userId).run(id);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      if (runtime && runtime.run.sessionId !== sessionId)
        throw new HttpError(404, "Run not found");
    }
    if (existing) await closeGovernanceWindow(id,owner);
    const c = new RuntimeClient(owner.domainId, undefined, owner.userId);
    await c.request(
      `/v1/sessions/${sessionId}/run-intents/${id}/cancel`,
      "POST",
      {},
    );
    try {
      return { run: publicRun((await c.run(id)).run) };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { run: null };
      throw e;
    }
  },
  async delete(sessionId: string, owner: AssistantOwner) {
    await assistantStore.session(sessionId, owner);
    const c = new RuntimeClient(owner.domainId, undefined, owner.userId);
    let snapshot;
    try {
      snapshot = await c.session(sessionId);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    if (snapshot?.latestRun?.run.status === "running")
      throw new HttpError(409, "Conversation is running", "SESSION_BUSY");
    const scopes = (await db().query(`SELECT retrieval_scope_id FROM ${table("assistant_turns")} WHERE session_id=$1 AND retrieval_scope_id IS NOT NULL`, [sessionId])).rows;
    const removed = new Set<string>();
    for (const scope of scopes) {
      const ontology = new OntologyRetrievalClient(owner, scope.retrieval_scope_id);
      try {
        await ontology.closeScope();
        for (const link of await ontology.links()) {
          if (removed.has(link.retrievalId)) continue;
          await ontology.delete(link.retrievalId);
          removed.add(link.retrievalId);
        }
      } catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
    }
    if (snapshot) await c.deleteSession(sessionId);
    await transaction(async (tx) => {
      await tx.query(
        `DELETE FROM ${table("assistant_external_threads")} WHERE session_id=$1`,
        [sessionId],
      );
      await tx.query(
        `DELETE FROM ${table("assistant_sessions")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`,
        [sessionId, owner.domainId, owner.userId],
      );
    });
  },
  async rename(sessionId: string, title: string, owner: AssistantOwner) {
    await assistantStore.session(sessionId, owner);
    await db().query(`UPDATE ${table("assistant_sessions")} SET title=$4 WHERE id=$1 AND domain_id=$2 AND owner_id=$3`, [sessionId, owner.domainId, owner.userId, title]);
  },
  async artifact(
    sessionId: string,
    id: string,
    owner: AssistantOwner,
  ): Promise<RuntimeArtifact> {
    await assistantStore.session(sessionId, owner);
    const a = runtimeArtifactSchema.parse(
      await new RuntimeClient(owner.domainId, undefined, owner.userId).request(`/v1/artifacts/${id}`),
    );
    if (a.sessionId !== sessionId)
      throw new HttpError(404, "Artifact not found");
    return a;
  },
  async content(sessionId: string, id: string, owner: AssistantOwner) {
    await this.artifact(sessionId, id, owner);
    return new RuntimeClient(owner.domainId, undefined, owner.userId).bytes(
      `/v1/artifacts/${id}/content`,
    );
  },
  async resolve(
    sessionId: string,
    runId: string,
    path: string,
    owner: AssistantOwner,
  ) {
    await this.ownRun(sessionId, runId, owner);
    const result = z
      .object({ artifacts: z.array(runtimeArtifactSchema) })
      .parse(
        await new RuntimeClient(owner.domainId, undefined, owner.userId).request(
          `/v1/runs/${runId}/artifacts?path=${encodeURIComponent(path)}`,
        ),
      );
    return { artifact: result.artifacts.at(-1) ?? null };
  },
  /** The page draft a run wrote: its own artifact read, then the envelope every page receives. */
  async pageDraft(
    sessionId: string,
    runId: string,
    path: string,
    owner: AssistantOwner,
  ) {
    const { artifact } = await this.resolve(sessionId, runId, path, owner);
    if (!artifact) throw new HttpError(404, "Page draft not found");
    return pageDraftSchema.parse(
      JSON.parse((await this.content(sessionId, artifact.id, owner)).toString("utf-8")),
    );
  },
  async datasetSource(sessionId: string, id: string, owner: AssistantOwner) {
    const a = await this.artifact(sessionId, id, owner);
    for (const turn of await assistantStore.turns(sessionId)) {
      if (!turn.retrieval_scope_id) continue;
      const ontology = new OntologyRetrievalClient(owner, turn.retrieval_scope_id);
      for (const link of await ontology.links()) {
        const evidence = await ontology.evidence(link.retrievalId, link.runId);
        for (const output of evidence.snapshot.bindings?.datasets ?? []) {
          if (output.sha256 !== a.sha256) continue;
          await ontology.dataset(link.retrievalId, output.id);
          return { retrievalId: link.retrievalId, sourceOutputId: output.id };
        }
        const sourceSession = evidence.snapshot.runtimeSessionId;
        if (!sourceSession) continue;
        for (const artifactId of evidence.snapshot.datasetArtifactIds) {
          const source = await ontology.artifact(sourceSession, artifactId);
          if (source.sha256 !== a.sha256) continue;
          await ontology.dataset(link.retrievalId, artifactId);
          return { retrievalId: link.retrievalId, sourceArtifactId: artifactId };
        }
      }
    }
    throw new HttpError(404, "Accepted dataset not found");
  },
  async dataset(sessionId: string, id: string, owner: AssistantOwner) {
    const source = await this.datasetSource(sessionId, id, owner);
    return {
      source,
      payload: datasetPayloadSchema.parse(
        JSON.parse((await this.content(sessionId, id, owner)).toString()),
      ),
    };
  },
  async feedback(sessionId: string, owner: AssistantOwner, runId?: string) {
    await assistantStore.session(sessionId, owner);
    const rows = (
      await db().query(
        `SELECT * FROM ${table("assistant_feedback")} WHERE session_id=$1 AND ($2::uuid IS NULL OR run_id=$2) ORDER BY updated_at,id`,
        [sessionId, runId ?? null],
      )
    ).rows;
    return { feedback: rows.map(feedbackView) };
  },
  async saveFeedback(
    sessionId: string,
    owner: AssistantOwner,
    input: AssistantFeedbackWrite,
  ) {
    const s = await this.readRun(sessionId, input.runId, owner);
    if (input.target.kind === "message") {
      // A message rating is a rating of the run's answer, the one message the runtime named.
      if (input.target.id !== s.run.answerMessageId)
        throw new HttpError(404, "Message not found");
    } else {
      const a = await this.artifact(sessionId, input.target.id, owner);
      if (a.runId !== input.runId)
        throw new HttpError(404, "Artifact not found");
    }
    const r = await db().query(
      `INSERT INTO ${table("assistant_feedback")} (id,session_id,run_id,target_kind,target_id,rating,text) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_id,run_id,target_kind,target_id) DO UPDATE SET rating=EXCLUDED.rating,text=EXCLUDED.text,updated_at=now() RETURNING *`,
      [
        randomUUID(),
        sessionId,
        input.runId,
        input.target.kind,
        input.target.id,
        input.rating,
        input.text,
      ],
    );
    return feedbackView(r.rows[0]);
  },
  async deleteFeedback(sessionId: string, id: string, owner: AssistantOwner) {
    await assistantStore.session(sessionId, owner);
    await db().query(
      `DELETE FROM ${table("assistant_feedback")} WHERE id=$1 AND session_id=$2`,
      [id, sessionId],
    );
  },

};
function feedbackView(row: Record<string, any>) {
  return assistantFeedbackSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    target: { kind: row.target_kind, id: row.target_id },
    rating: row.rating,
    text: row.text,
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

const RECONCILE_MS = 30_000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconciling = false;
/** Runs the reconciliation once at startup and then every 30 seconds. */
export function startAssistantReconciliation() {
  if (reconcileTimer) return;
  const tick = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await assistantService.reconcile();
    } catch (error) {
      logger.error("Assistant reconciliation failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      reconciling = false;
    }
  };
  void tick();
  reconcileTimer = setInterval(() => void tick(), RECONCILE_MS);
  reconcileTimer.unref?.();
}
