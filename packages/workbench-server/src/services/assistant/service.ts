import { getLogContext } from "../../logging/log-context";
import { assistantOntologyContext } from "./context";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  assistantFeedbackSchema,
  type AssistantFeedbackWrite,
} from "@ontomato/contracts/assistant-chat";
import {
  agentHostRunSchema,
  agentHostSessionSchema,
  agentHostAgentSchema,
} from "@ontomato/contracts/agent-host";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import {
  runtimeArtifactSchema,
  type RuntimeArtifact,
} from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import {
  retrievalInputSchema,
  datasetPayloadSchema,
} from "@ontomato/contracts/data-retrieval";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { environment } from "../../config/environment";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { assistantStore, type AssistantOwner, type SessionRow } from "./store";
import {
  messageText,
  modelCredential,
  runDefinition,
  type AssistantCredentials,
} from "../../platform/agent-runtime/runtime";
import { retrievalService } from "../data-retrieval/service";
import { transaction, retrievalStore } from "../data-retrieval/store";
import { HttpError } from "../../utils/errors";
import { createLogger } from "../../logging/logger";
const db = () => getPostgresPool(),
  logger = createLogger("assistant"),
  observing = new Set<string>();
const publicRun = (run: RuntimeRunSnapshot["run"]) =>
  agentHostRunSchema.parse(
    Object.fromEntries(
      Object.keys(agentHostRunSchema.shape).map((k) => [
        k,
        run[k as keyof typeof run],
      ]),
    ),
  );
export const publicSnapshot = (s: RuntimeRunSnapshot) => ({
  ...s,
  run: publicRun(s.run),
});
const sessionView = (s: SessionRow, latestRun: RuntimeRunSnapshot | null) =>
  agentHostSessionSchema.parse({
    id: s.id,
    agentId: s.agent_id,
    title: s.title,
    createdAt: new Date(s.created_at).toISOString(),
    updatedAt: new Date(s.updated_at).toISOString(),
    latestRun: latestRun ? publicRun(latestRun.run) : null,
  });
export { sessionView };
export const assistantService = {
  async agents(owner: AssistantOwner, locale?: string) {
    return {
      agents: (await assistantStore.agents(owner.domainId, locale)).map((a) =>
        agentHostAgentSchema.parse({
          id: a.id,
          name: a.name,
          description: a.description,
          icon: a.icon ?? null,
          enabled: a.enabled,
        }),
      ),
    };
  },
  async create(id: string, owner: AssistantOwner, input: { agentId: string }) {
    const { row, replayed } = await assistantStore.create(
      id,
      owner,
      input.agentId,
    );
    try {
      await new RuntimeClient(owner.domainId).createSession(id);
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
    return {
      session: sessionView(
        row,
        (await new RuntimeClient(owner.domainId).session(id)).latestRun,
      ),
      replayed,
    };
  },
  async list(
    owner: AssistantOwner,
    input: {
      agentId: string;
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
            agentId: z.string(),
          })
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      } catch {
        throw new HttpError(400, "Invalid session cursor", "INVALID_REQUEST");
      }
    }
    if (cursor && cursor.agentId !== input.agentId)
      throw new HttpError(400, "Cursor filters differ");
    const rows = (
      await db().query(
        `SELECT * FROM ${table("assistant_sessions")} WHERE domain_id=$1 AND owner_id=$2 AND agent_id=$3 AND ($4::timestamptz IS NULL OR (updated_at,id)<($4,$5::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $6`,
        [
          owner.domainId,
          owner.userId,
          input.agentId,
          cursor?.updatedAt ?? null,
          cursor?.id ?? null,
          input.limit + 1,
        ],
      )
    ).rows as SessionRow[];
    const selected = rows.slice(0, input.limit),
      sessions = [];
    const statuses = selected.length
      ? await new RuntimeClient(owner.domainId).sessionStatuses(
          selected.map((row) => row.id),
        )
      : [];
    for (const row of selected) {
      const latestId = statuses.find((s) => s.session.id === row.id)?.latestRun
        ?.id;
      const latest = latestId
        ? await this.readRun(row.id, latestId, owner)
        : null;
      sessions.push(
        sessionView(await assistantStore.session(row.id, owner), latest),
      );
    }
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
              }),
            ).toString("base64url")
          : null,
    };
  },
  async snapshot(id: string, owner: AssistantOwner) {
    const row = await assistantStore.session(id, owner),
      s = await new RuntimeClient(owner.domainId).session(id);
    if (s.latestRun) {
      await assistantStore.admitted(
        s.latestRun.run.id,
        messageText(
          s.latestRun.messages.find((m) => m.message.role === "user")
            ?.message ?? { content: "" },
        ),
      );
      await this.settle(s.latestRun, owner);
      if (s.latestRun.run.status === "running") {
        const c = getLogContext();
        this.observe(s.latestRun.run.id, owner, {
          token: c?.token,
          apiKey: c?.apiKey,
        });
      }
    }
    return {
      session: sessionView(
        await assistantStore.session(row.id, owner),
        s.latestRun,
      ),
      messages: s.messages,
      latestRun: s.latestRun ? publicSnapshot(s.latestRun) : null,
    };
  },
  async readRun(sessionId: string, id: string, owner: AssistantOwner) {
    const turn = await assistantStore.turn(id, owner);
    if (turn.session_id !== sessionId)
      throw new HttpError(404, "Run not found");
    const s = await new RuntimeClient(owner.domainId).run(id);
    await assistantStore.admitted(
      id,
      messageText(
        s.messages.find((m) => m.message.role === "user")?.message ?? {
          content: "",
        },
      ),
    );
    await this.settle(s, owner);
    if (s.run.status === "running") {
      const c = getLogContext();
      this.observe(id, owner, { token: c?.token, apiKey: c?.apiKey });
    }
    return s;
  },
  async settle(s: RuntimeRunSnapshot, owner: AssistantOwner) {
    if (s.run.status === "stopped") {
      await assistantStore.close(s.run.id);
      const context = getLogContext();
      await this.stopChildren(s.run.id, owner, {
        token: context?.token,
        apiKey: context?.apiKey,
      });
    }
  },
  async stopChildren(
    id: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    const children = await retrievalStore.cancelParent(id, owner);
    for (const childId of children) {
      const child = await retrievalStore.get(childId, owner);
      // Leave completed retrievals and their asynchronous QC alone.
      if (child.snapshot.run?.status !== "stopped")
        await retrievalService.cancel(childId, owner, credentials);
    }
  },
  async start(
    sessionId: string,
    id: string,
    message: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    const session = await assistantStore.session(sessionId, owner),
      client = new RuntimeClient(owner.domainId);
    try {
      const previous = await assistantStore.turn(id, owner);
      if (
        previous.session_id !== sessionId ||
        previous.input_hash !==
          createHash("sha256").update(message).digest("hex")
      )
        throw new HttpError(
          409,
          "Idempotency key reused",
          "IDEMPOTENCY_CONFLICT",
        );
      return {
        snapshot: publicSnapshot(await this.readRun(sessionId, id, owner)),
        replayed: true,
      };
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
    }
    const a = await assistantStore.agent(session.agent_id, owner);
    if (session.latest_run_id) {
      try {
        await this.readRun(sessionId, session.latest_run_id, owner);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    if (!a.enabled)
      throw new HttpError(409, "Agent disabled", "AGENT_DISABLED");
    const { row: turn, replayed } = await assistantStore.reserve(
      sessionId,
      id,
      message,
      owner,
      a.class_names,
    );
    if (replayed) {
      try {
        return {
          snapshot: publicSnapshot(await this.readRun(sessionId, id, owner)),
          replayed: true,
        };
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    let ontologyContext: string;
    try {
      ontologyContext = await assistantOntologyContext(
        a,
        message,
        owner,
        credentials,
      );
    } catch (error) {
      await assistantStore.close(id);
      throw error;
    }
    const prefix = `/api/assistant/sessions/${sessionId}/runs/${id}/retrievals`;
    try {
      await client.start(sessionId, id, {
        language: credentials.locale ?? "en",
        input: {
          role: "user",
          content: message,
          timestamp: new Date(turn.created_at).getTime(),
        },
        definition: runDefinition(
          a.system_prompt +
            "\n\nInitial ontology context:\n" +
            ontologyContext +
            "\n\n" +
            ARTIFACT_MARKDOWN_PROMPT,
          a.model_role,
          a.skills,
          credentials.locale,
        ),
        modelCredential: modelCredential(credentials),
        environment: {
          values: {
            ONTOMATO_WORKBENCH_URL: environment
              .agentRuntime()
              .callbackUrl.replace(/\/$/, ""),
            ONTOMATO_ASSISTANT_SESSION_ID: sessionId,
          },
          secrets: {
            ONTOMATO_TK: callbackCredential({
              pathPrefix: prefix,
              runId: id,
              expiresAt: Date.now() + getQueryTimeoutMs(),
              token: credentials.token ?? "",
              apiKey: credentials.apiKey ?? "",
            }).value,
          },
        },
      });
    } catch (error) {
      try {
        const found = await client.run(id);
        await assistantStore.admitted(id, message);
        this.observe(id, owner, credentials);
        return { snapshot: publicSnapshot(found), replayed };
      } catch (readError) {
        if (readError instanceof HttpError && readError.status === 404)
          await assistantStore.close(id);
      }
      if (error instanceof HttpError && error.status === 410)
        throw new HttpError(404, "Run not found", "NOT_FOUND");
      throw error;
    }
    await assistantStore.admitted(id, message);
    this.observe(id, owner, credentials);
    return { snapshot: publicSnapshot(await client.run(id)), replayed };
  },
  observe(
    id: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    if (observing.has(id)) return;
    observing.add(id);
    void (async () => {
      try {
        for (;;) {
          const s = await new RuntimeClient(owner.domainId).run(id);
          if (s.run.status === "stopped") {
            await assistantStore.close(id);
            await this.stopChildren(id, owner, credentials);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (e) {
        logger.error("Assistant observation needs reconciliation", {
          runId: id,
          error: e,
        });
      } finally {
        observing.delete(id);
      }
    })();
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
        runtime = await new RuntimeClient(owner.domainId).run(id);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      if (runtime && runtime.run.sessionId !== sessionId)
        throw new HttpError(404, "Run not found");
    }
    await assistantStore.close(id);
    await retrievalService.cancelParent(id, owner, credentials);
    const c = new RuntimeClient(owner.domainId);
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
    const c = new RuntimeClient(owner.domainId);
    let snapshot;
    try {
      snapshot = await c.session(sessionId);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    if (snapshot?.latestRun?.run.status === "running")
      throw new HttpError(409, "Conversation is running", "SESSION_BUSY");
    const children = (
      await db().query(
        `SELECT DISTINCT r.id,r.work_session_id FROM ${table("retrievals")} r JOIN ${table("assistant_retrievals")} l ON l.retrieval_id=r.id WHERE l.session_id=$1`,
        [sessionId],
      )
    ).rows;
    for (const child of children) {
      try {
        const rs = await c.session(child.work_session_id);
        if (rs.latestRun?.run.status === "running")
          await c.cancel(rs.latestRun.run.id);
        await c.deleteSession(child.work_session_id);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      await transaction(async (tx) => {
        await tx.query(
          `DELETE FROM ${table("retrieval_submissions")} WHERE run_id IN(SELECT id FROM ${table("retrieval_rounds")} WHERE retrieval_id=$1)`,
          [child.id],
        );
        await tx.query(
          `DELETE FROM ${table("retrieval_rounds")} WHERE retrieval_id=$1`,
          [child.id],
        );
        await tx.query(
          `DELETE FROM ${table("retrievals")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`,
          [child.id, owner.domainId, owner.userId],
        );
      });
    }
    if (snapshot) await c.deleteSession(sessionId);
    await transaction(async (tx) => {
      await tx.query(
        `DELETE FROM ${table("assistant_external_threads")} WHERE session_id=$1`,
        [sessionId],
      );
      await tx.query(
        `DELETE FROM ${table("retrieval_parent_gates")} WHERE domain_id=$1 AND owner_id=$2 AND parent_id IN(SELECT id::text FROM ${table("assistant_turns")} WHERE session_id=$3)`,
        [owner.domainId, owner.userId, sessionId],
      );
      await tx.query(
        `DELETE FROM ${table("assistant_sessions")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`,
        [sessionId, owner.domainId, owner.userId],
      );
    });
  },
  async artifact(
    sessionId: string,
    id: string,
    owner: AssistantOwner,
  ): Promise<RuntimeArtifact> {
    await assistantStore.session(sessionId, owner);
    const a = runtimeArtifactSchema.parse(
      await new RuntimeClient(owner.domainId).request(`/v1/artifacts/${id}`),
    );
    if (a.sessionId !== sessionId)
      throw new HttpError(404, "Artifact not found");
    return a;
  },
  async content(sessionId: string, id: string, owner: AssistantOwner) {
    await this.artifact(sessionId, id, owner);
    return new RuntimeClient(owner.domainId).bytes(
      `/v1/artifacts/${id}/content`,
    );
  },
  async resolve(
    sessionId: string,
    runId: string,
    path: string,
    owner: AssistantOwner,
  ) {
    await this.readRun(sessionId, runId, owner);
    const result = z
      .object({ artifacts: z.array(runtimeArtifactSchema) })
      .parse(
        await new RuntimeClient(owner.domainId).request(
          `/v1/runs/${runId}/artifacts?path=${encodeURIComponent(path)}`,
        ),
      );
    return { artifact: result.artifacts.at(-1) ?? null };
  },
  async datasetSource(sessionId: string, id: string, owner: AssistantOwner) {
    const a = await this.artifact(sessionId, id, owner),
      client = new RuntimeClient(owner.domainId);
    const rows = (
      await db().query(
        `SELECT s.artifact_id,t.retrieval_id,t.qc_result FROM ${table("retrieval_submissions")} s JOIN ${table("retrieval_rounds")} t ON t.id=s.run_id JOIN ${table("assistant_retrievals")} l ON l.retrieval_id=t.retrieval_id WHERE l.session_id=$1 AND s.artifact_id IS NOT NULL`,
        [sessionId],
      )
    ).rows;
    for (const row of rows) {
      const source = runtimeArtifactSchema.parse(
        await client.request(`/v1/artifacts/${row.artifact_id}`),
      );
      if (source.sha256 === a.sha256) {
        await retrievalService.dataset(
          owner,
          row.artifact_id,
          row.retrieval_id,
        );
        return {
          retrievalId: row.retrieval_id as string,
          sourceArtifactId: row.artifact_id as string,
          ...(row.qc_result ? { qualityCheck: row.qc_result } : {}),
        };
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
      if (
        !s.messages.some(
          (m) => m.id === input.target.id && m.message.role === "assistant",
        )
      )
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
  async child(
    sessionId: string,
    parentId: string,
    retrievalId: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    await assistantStore.session(sessionId, owner);
    const r = await db().query(
      `SELECT 1 FROM ${table("assistant_retrievals")} WHERE retrieval_id=$1 AND session_id=$2 AND parent_run_id=$3`,
      [retrievalId, sessionId, parentId],
    );
    if (!r.rowCount) throw new HttpError(404, "Retrieval not found");
    return retrievalService.get(retrievalId, owner, credentials);
  },
  async retrieve(
    sessionId: string,
    parentId: string,
    key: string,
    body: unknown,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    const input = z
      .object({
        question: z.string().optional(),
        retrievalId: z.string().uuid().optional(),
        message: z.string().optional(),
      })
      .strict()
      .parse(body);
    const retrievalId = input.retrievalId ?? key;
    if (!(input.retrievalId ? input.message : input.question)?.trim())
      throw new HttpError(400, "Question or reply is required");
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const prior = input.retrievalId
      ? await retrievalService.get(retrievalId, owner, credentials)
      : null;
    const request: Record<string, unknown> = prior
      ? {
          message: input.message,
          expectedRunId: prior.runtimeRunId,
          expectedDecisionRevision: prior.decisionRevision,
        }
      : retrievalInputSchema.parse({
          question: input.question,
          userQuotes: [input.question],
          previousDatasetIds: [],
          interaction: "resumable",
        });
    const admitted = await transaction(async (c) => {
      const turn = await assistantStore.requireOpen(parentId, owner, c);
      if (turn.session_id !== sessionId)
        throw new HttpError(404, "Run not found");
      const old = (
        await c.query(
          `SELECT * FROM ${table("assistant_retrievals")} WHERE operation_id=$1`,
          [key],
        )
      ).rows[0];
      if (old) {
        if (
          old.session_id !== sessionId ||
          old.parent_run_id !== parentId ||
          old.input_hash !== hash
        )
          throw new HttpError(
            409,
            "Idempotency key reused",
            "IDEMPOTENCY_CONFLICT",
          );
        return old;
      }
      if (input.retrievalId) {
        const r = await c.query(
          `SELECT 1 FROM ${table("assistant_retrievals")} WHERE retrieval_id=$1 AND session_id=$2`,
          [retrievalId, sessionId],
        );
        if (!r.rowCount) throw new HttpError(404, "Retrieval not found");
        await c.query(
          `UPDATE ${table("retrievals")} SET parent_id=$2 WHERE id=$1`,
          [retrievalId, parentId],
        );
      }
      if (!input.retrievalId) request.classNames = turn.class_names;
      return (
        await c.query(
          `INSERT INTO ${table("assistant_retrievals")} (operation_id,retrieval_id,request,input_hash,session_id,parent_run_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [key, retrievalId, request, hash, sessionId, parentId],
        )
      ).rows[0];
    });
    const snapshot = input.retrievalId
      ? await retrievalService.answer(
          retrievalId,
          owner,
          credentials,
          key,
          admitted.request,
        )
      : await retrievalService.start(
          retrievalId,
          owner,
          credentials,
          admitted.request,
          parentId,
        );
    await db().query(
      `UPDATE ${table("assistant_retrievals")} SET retrieval_run_id=$2 WHERE operation_id=$1`,
      [key, snapshot.runtimeRunId],
    );
    return snapshot;
  },
  async childContent(
    sessionId: string,
    parentId: string,
    id: string,
    artifactId: string,
    owner: AssistantOwner,
    credentials: AssistantCredentials,
  ) {
    await this.child(sessionId, parentId, id, owner, credentials);
    await retrievalService.dataset(owner, artifactId, id);
    return new RuntimeClient(owner.domainId).bytes(
      `/v1/artifacts/${artifactId}/content`,
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
