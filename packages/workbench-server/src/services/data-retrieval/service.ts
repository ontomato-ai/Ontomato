import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  datasetPayloadSchema,
  finishRetrievalSchema,
  submitDatasetSchema,
  retrievalAnswersSchema,
  retrievalResultSchema,
  type RetrievalInput,
  type DatasetPayload,
} from "@ontomato/contracts/data-retrieval";
import { codeExecutionSchema } from "@ontomato/contracts/agent-runtime-code";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { RuntimeClient } from "../agent-runtime/client";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { renderPrompt } from "../../core/prompts/loader";
import { getQueryTimeoutMs } from "../data-query/data-query-policy";
import { environment } from "../../config/environment";
import { getApiConfig } from "../../config/data-query-api";
import { HttpError } from "../../utils/errors";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { createLogger } from "../../logging/logger";
import {
  retrievalStore,
  transaction,
  fingerprint,
  type RetrievalOwner,
  type RetrievalRecord,
} from "./store";
import { ontologyRequest, type RetrievalCredentials } from "./ontology";
import { retrievalSkill, ontologySkill } from "./skill";

const logger = createLogger("data-retrieval");
const active = new Map<string, Promise<void>>();
const qualityActive = new Set<string>();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nullableItems = z
  .object({ items: z.array(z.record(z.unknown())) })
  .passthrough();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

async function artifact(
  owner: RetrievalOwner,
  id: string,
  retrievalId?: string,
) {
  const result = await getPostgresPool().query(
    `SELECT 1 FROM ${table("retrieval_submissions")} s JOIN ${table("retrieval_rounds")} t ON t.id=s.run_id JOIN ${table("retrievals")} r ON r.id=t.retrieval_id WHERE s.artifact_id=$1 AND r.domain_id=$2 AND r.owner_id=$3${retrievalId ? " AND r.id=$4" : ""}`,
    [id, owner.domainId, owner.userId, ...(retrievalId ? [retrievalId] : [])],
  );
  if (!result.rowCount) throw new HttpError(404, "Dataset not found");
  const value = runtimeArtifactSchema.parse(
    await new RuntimeClient(owner.domainId).request(`/v1/artifacts/${id}`),
  );
  if (value.content.type !== "workbench.dataset.v1")
    throw new Error("Referenced artifact is not a dataset");
  return {
    id: value.id,
    payload: datasetPayloadSchema.parse(value.content.payload),
  };
}

export const retrievalService = {
  async start(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    input: RetrievalInput,
    parentId: string | null = null,
  ) {
    for (const previous of input.previousDatasetIds)
      await artifact(owner, previous);
    const admission = await retrievalStore.create(
      id,
      owner,
      input,
      parentId,
      new Date(Date.now() + getQueryTimeoutMs()),
    );
    if (!admission.replayed) this.launch(admission.record, credentials);
    return admission.record.snapshot;
  },
  launch(
    record: RetrievalRecord,
    credentials: RetrievalCredentials,
    answerText?: string,
    previousRunId?: string,
  ) {
    const id = record.snapshot.id;
    const runKey = record.snapshot.runtimeRunId!;
    if (active.has(runKey)) return;
    const work = this.prepare(record, credentials, answerText, previousRunId)
      .then(() => this.observe(id, record.owner, credentials, runKey))
      .catch(async (error: unknown) => {
        logger.warn("Retrieval execution failed", {
          retrievalId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.cancel(
          id,
          record.owner,
          credentials,
          error instanceof Error ? error.message : String(error),
          runKey,
          "RETRIEVAL_EXECUTION_FAILED",
        );
      })
      .finally(() => active.delete(runKey));
    active.set(runKey, work);
    void work.catch((error) =>
      logger.error("Retrieval settlement failed", { retrievalId: id, error }),
    );
  },
  async prepare(
    record: RetrievalRecord,
    credentials: RetrievalCredentials,
    answerText?: string,
    previousRunId?: string,
  ) {
    const { owner, input, snapshot } = record,
      runId = snapshot.runtimeRunId!,
      client = new RuntimeClient(owner.domainId, runId);
    const round = await retrievalStore.round(runId);
    await client.createSession(snapshot.runtimeSessionId);
    const [overview, knowledge, metrics] = await Promise.all([
      ontologyRequest("/ontology/query/overview", credentials),
      ontologyRequest("/ontology/query/knowledge/search", credentials, {
        query: input.question,
        limit: 10,
      }),
      ontologyRequest("/ontology/query/metrics/search", credentials, {
        query: input.question,
        limit: 10,
        cursor: null,
        ...(input.classNames ? { classNames: input.classNames } : {}),
      }),
    ]);
    nullableItems.parse(knowledge);
    nullableItems.parse(metrics);
    const grant = await ontologyRequest(
      "/internal/query-grants/exploration",
      credentials,
      {
        retrievalId: snapshot.id,
        runtimeSessionId: snapshot.runtimeSessionId,
        runtimeRunId: runId,
        expiresAt: new Date(round.deadline).toISOString(),
        classNames: input.classNames ?? [],
      },
    );
    const authorization = z
      .object({
        credential: z.object({
          kind: z.literal("bearer"),
          value: z.string().min(1),
        }),
        expiresAt: z.string().datetime(),
      })
      .parse(grant);
    const exploration = authorization.credential;
    round.deadline = new Date(
      Math.min(
        new Date(round.deadline).getTime(),
        Date.parse(authorization.expiresAt),
      ),
    );
    await getPostgresPool().query(
      `UPDATE ${table("retrieval_rounds")} SET deadline=LEAST(deadline,$2) WHERE id=$1`,
      [runId, round.deadline],
    );
    const previousIds = [
      ...new Set([...input.previousDatasetIds, ...snapshot.datasetArtifactIds]),
    ];
    const prior = await Promise.all(
      previousIds.map((id) => artifact(owner, id)),
    );
    const initialFiles: { path: string; content: string }[] = [];
    if (previousRunId) {
      const old = z
        .object({ executions: z.array(codeExecutionSchema) })
        .parse(
          await client.request(`/v1/runs/${previousRunId}/code-executions`),
        );
      const latest = new Map<string, string>();
      for (const execution of old.executions)
        if (execution.status === "completed")
          latest.set(execution.entry, execution.source);
      for (const [path, content] of latest)
        initialFiles.push({ path, content });
    }

    const context = {
      question: input.question,
      userQuotes: input.userQuotes,
      overview,
      knowledge: knowledge.items,
      metrics: metrics.items,
      moreMetrics: metrics.nextCursor ?? null,
      previousDatasets: prior.map((a) => ({
        id: a.id,
        title: a.payload.title,
        recipe: a.payload.recipe,
        assumptions: a.payload.assumptions,
      })),
      decisions: record.decisions.filter(
        (d) => !record.decisions.some((next) => next.supersedesId === d.id),
      ),
      resumedFiles: initialFiles.map((f) => f.path),
      answer: answerText ?? null,
    };
    const prefix = `/api/retrievals/${snapshot.id}/runtime/`;
    await transaction((c) => retrievalStore.gate(snapshot.id, owner, runId, c));
    await client.start(snapshot.runtimeSessionId, runId, {
      initialFiles,
      language: credentials.locale ?? "en",
      definition: {
        systemPrompt: renderPrompt(
          "data-retrieval.system",
          {},
          credentials.locale,
        ),
        modelRole: "coding",
        skills: [ontologySkill, retrievalSkill],
        builtinTools: { workspaceFiles: true, python: true },
        externalMcp: [],
        compaction: {
          systemPrompt: renderPrompt(
            "knowledge-governance.compaction.system",
            {},
            credentials.locale,
          ),
          summarizePrompt: renderPrompt(
            "knowledge-governance.compaction.summarize.user",
            {},
            credentials.locale,
          ),
          updatePrompt: renderPrompt(
            "knowledge-governance.compaction.update.user",
            {},
            credentials.locale,
          ),
        },
      },
      input: {
        role: "user",
        content: JSON.stringify(context),
        timestamp: Date.now(),
      },
      privateContext: {
        modelCredential: credentials.apiKey
          ? { kind: "api_key", value: credentials.apiKey }
          : credentials.token
            ? { kind: "token", value: credentials.token }
            : { kind: "none" },
        skillBindings: [
          {
            skill: ontologySkill,
            targetUrl: getApiConfig().baseUrl!,
            credential: exploration,
            context: {},
          },
          {
            skill: retrievalSkill,
            targetUrl:
              environment.agentRuntime().callbackUrl.replace(/\/$/, "") +
              "/api/retrievals",
            credential: callbackCredential({
              pathPrefix: prefix,
              runId,
              expiresAt: new Date(round.deadline).getTime(),
              token: credentials.token ?? "",
              apiKey: credentials.apiKey ?? "",
            }),
            context: { retrievalId: snapshot.id },
          },
        ],
        python: {
          targetUrl: getApiConfig().baseUrl!,
          credential: exploration,
          context: {},
          libraries: [{ skill: ontologySkill, path: "python" }],
          limits: {
            wallTimeMs: Math.max(
              1,
              new Date(round.deadline).getTime() - Date.now(),
            ),
            cpuSeconds: Math.max(1, Math.ceil(getQueryTimeoutMs() / 1000)),
            memoryBytes: 1024 ** 3,
            processCount: 32,
            fileBytes: 32 * 1024 ** 2,
            outputBytes: 16 * 1024 ** 2,
          },
        },
      },
    });
  },
  async observe(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    expectedRunId: string,
  ) {
    while (true) {
      const record = await retrievalStore.get(id, owner);
      if (
        record.snapshot.phase === "settled" ||
        record.snapshot.runtimeRunId !== expectedRunId
      )
        return;
      const round = await retrievalStore.round(record.snapshot.runtimeRunId!);
      if (Date.now() > new Date(round.deadline).getTime()) {
        await this.cancel(
          id,
          owner,
          credentials,
          "Retrieval timed out",
          expectedRunId,
          "RETRIEVAL_TIMEOUT",
        );
        return;
      }
      const statuses = await new RuntimeClient(owner.domainId).sessionStatuses([
        record.snapshot.runtimeSessionId,
      ]);
      if (statuses[0]?.latestRun?.status !== "running") {
        await this.settle(record, credentials);
        return;
      }
      await pause(250);
    }
  },
  async settle(record: RetrievalRecord, credentials: RetrievalCredentials) {
    const { snapshot, owner } = record,
      runId = snapshot.runtimeRunId!,
      client = new RuntimeClient(owner.domainId);
    const run = await client.run(runId);
    if (run.run.status === "running") return snapshot;
    const ids: string[] = [];
    await transaction(async (c) => {
      const current = await retrievalStore.get(snapshot.id, owner, c, true);
      if (current.snapshot.runtimeRunId !== runId) return;
      for (const item of run.artifacts) {
        if (item.content.type !== "workbench.dataset.v1") continue;
        datasetPayloadSchema.parse(item.content.payload);
        const linked = await c.query(
          `UPDATE ${table("retrieval_submissions")} SET artifact_id=$3,payload=NULL WHERE run_id=$1 AND tool_call_id=$2 RETURNING id`,
          [runId, item.toolCallId, item.id],
        );
        if (linked.rowCount) ids.push(item.id);
      }
    });
    const round = await retrievalStore.round(runId),
      submission = round.submission;
    let result;
    if (run.run.status !== "completed")
      result = {
        status: "failed",
        datasetArtifactIds: ids,
        error: {
          code: `RUNTIME_${run.run.status.toUpperCase()}`,
          message: run.run.error?.message ?? `Runtime ${run.run.status}`,
        },
      };
    else if (!submission)
      result = {
        status: "failed",
        datasetArtifactIds: ids,
        error: {
          code: "RETRIEVAL_RESULT_MISSING",
          message: "Retriever ended without a result submission",
        },
      };
    else if (submission.status === "completed" && ids.length === 0)
      result = {
        status: "failed",
        datasetArtifactIds: [],
        error: {
          code: "RETRIEVAL_RESULT_MISSING",
          message: "No committed dataset was returned",
        },
      };
    else
      result = {
        status: submission.status,
        datasetArtifactIds: ids,
        ...(submission.status === "failed"
          ? { error: submission.error }
          : {
              summary: submission.summary,
              ...(submission.status === "needs_input"
                ? { questions: submission.questions }
                : {}),
            }),
      };
    const final = await retrievalStore.close(
      snapshot.id,
      owner,
      retrievalResultSchema.parse(result),
      runId,
    );
    await ontologyRequest("/internal/query-grants/revoke", credentials, {
      runtimeRunId: runId,
    }).catch((error) =>
      logger.warn("Grant revocation failed; deadline still applies", {
        runId,
        error,
      }),
    );
    if (final.result?.status === "completed")
      void this.quality(record, credentials).catch((error) =>
        logger.warn("Quality check failed", { runId, error }),
      );
    return final;
  },
  async get(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
  ) {
    const record = await retrievalStore.get(id, owner);
    if (
      record.snapshot.phase === "running" &&
      !active.has(record.snapshot.runtimeRunId!)
    ) {
      try {
        await new RuntimeClient(owner.domainId).run(
          record.snapshot.runtimeRunId!,
        );
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          return this.cancel(
            id,
            owner,
            credentials,
            "Retrieval preparation was interrupted",
            record.snapshot.runtimeRunId!,
            "RETRIEVAL_INTERRUPTED",
          );
        throw error;
      }
      const key = record.snapshot.runtimeRunId!;
      const work = this.observe(id, owner, credentials, key).finally(() =>
        active.delete(key),
      );
      active.set(key, work);
      void work.catch((error) =>
        logger.error("Recovery observation failed", { id, error }),
      );
    }
    const round = await retrievalStore.round(record.snapshot.runtimeRunId!);
    if (record.snapshot.result?.status === "completed" && !round.qc_result)
      void this.quality(record, credentials).catch((error) =>
        logger.warn("Quality recovery failed", { id, error }),
      );
    return {
      ...record.snapshot,
      ...(round.qc_result ? { qualityCheck: round.qc_result } : {}),
    };
  },
  async cancel(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    message = "Retrieval cancelled",
    expectedRunId?: string,
    code = "RETRIEVAL_CANCELLED",
  ) {
    const record = await retrievalStore.get(id, owner),
      runId = expectedRunId ?? record.snapshot.runtimeRunId!;
    if (record.snapshot.runtimeRunId !== runId) return record.snapshot;
    const snapshot = await retrievalStore.close(
      id,
      owner,
      {
        status: "failed",
        datasetArtifactIds: record.snapshot.datasetArtifactIds,
        error: { code, message },
      },
      runId,
    );
    const pending = await getPostgresPool().query(
      `SELECT id FROM ${table("retrieval_submissions")} WHERE run_id=$1`,
      [runId],
    );
    const quality = await transaction(async (c) => {
      await c.query(
        `UPDATE ${table("retrieval_rounds")} SET qc_result=COALESCE(qc_result,'{"status":"cancelled"}'::jsonb) WHERE id=$1`,
        [runId],
      );
      return (
        await c.query(
          `SELECT qc_id FROM ${table("retrieval_rounds")} WHERE id=$1`,
          [runId],
        )
      ).rows[0]?.qc_id as string | undefined;
    });
    const cancellations = await Promise.allSettled([
      ...(quality
        ? [
            ontologyRequest(
              `/query-quality-checks/${quality}/cancel`,
              credentials,
              {},
            ),
          ]
        : []),
      new RuntimeClient(owner.domainId).request(
        `/v1/sessions/${record.snapshot.runtimeSessionId}/run-intents/${runId}/cancel`,
        "POST",
        {},
      ),
      ontologyRequest("/internal/query-grants/revoke", credentials, {
        runtimeRunId: runId,
      }),
      ...pending.rows.map((r) =>
        ontologyRequest(
          `/ontology/query/outputs/${r.id}/cancel`,
          credentials,
          {},
        ),
      ),
    ]);
    for (const result of cancellations)
      if (result.status === "rejected")
        logger.warn(
          "Retrieval cancellation request failed; grants remain deadline bounded",
          { runId, error: result.reason },
        );
    return snapshot;
  },
  async answer(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    key: string,
    body: unknown,
  ) {
    const input = retrievalAnswersSchema.parse(body),
      hash = fingerprint(input);
    const record = await transaction(async (c) => {
      const known = await retrievalStore.get(id, owner, c);
      if (known.parentId) {
        const gate = await c.query(
          `SELECT closed FROM ${table("retrieval_parent_gates")} WHERE domain_id=$1 AND owner_id=$2 AND parent_id=$3 FOR UPDATE`,
          [owner.domainId, owner.userId, known.parentId],
        );
        if (gate.rows[0]?.closed)
          throw new HttpError(409, "Parent run is closed");
      }
      const current = await retrievalStore.get(id, owner, c, true);
      const old = await c.query(
        `SELECT request_hash FROM ${table("retrieval_rounds")} WHERE id=$1 AND retrieval_id=$2`,
        [key, id],
      );
      if (old.rowCount) {
        if (old.rows[0].request_hash !== hash)
          throw new HttpError(409, "Reply input changed");
        return { ...current, replayed: true };
      }
      if (
        current.snapshot.phase !== "settled" ||
        current.snapshot.runtimeRunId !== input.expectedRunId ||
        current.snapshot.decisionRevision !== input.expectedDecisionRevision
      )
        throw new HttpError(
          409,
          "Retrieval round or decision revision changed",
        );
      const questions =
        current.snapshot.result?.status === "needs_input"
          ? current.snapshot.result.questions
          : [];
      const decisions = [...current.decisions];
      const seen = new Set<string>();
      for (const answer of input.answers) {
        if (seen.has(answer.questionId))
          throw new HttpError(400, "Duplicate question reply");
        seen.add(answer.questionId);
        const previous = [...decisions]
          .reverse()
          .find((d) => d.questionId === answer.questionId);
        const question = questions.find((q) => q.id === answer.questionId);
        if (!question && !previous)
          throw new HttpError(
            400,
            "Question does not belong to this retrieval",
          );
        const choice = question?.choices.find((c) => c.id === answer.choiceId);
        if (answer.choiceId && question && !choice)
          throw new HttpError(400, "Unknown choice");
        const text = answer.text?.trim() || choice?.label;
        if (!text) throw new HttpError(400, "An explicit answer is required");
        decisions.push({
          id: randomUUID(),
          questionId: answer.questionId,
          question: question?.question ?? previous!.question,
          choiceId: answer.choiceId ?? null,
          text,
          scope: question?.scope ?? previous!.scope,
          source: "user",
          supersedesId: previous?.id ?? null,
        });
      }
      const snapshot = {
        ...current.snapshot,
        runtimeRunId: key,
        phase: "running" as const,
        result: null,
        revision: current.snapshot.revision + 1,
        decisionRevision: current.snapshot.decisionRevision + 1,
      };
      await c.query(
        `UPDATE ${table("retrieval_rounds")} SET open=false WHERE retrieval_id=$1`,
        [id],
      );
      await c.query(
        `INSERT INTO ${table("retrieval_rounds")} (id,retrieval_id,request_hash,open,deadline) VALUES($1,$2,$3,true,$4)`,
        [key, id, hash, new Date(Date.now() + getQueryTimeoutMs())],
      );
      await c.query(
        `UPDATE ${table("retrievals")} SET snapshot=$2,decisions=$3 WHERE id=$1`,
        [id, snapshot, JSON.stringify(decisions)],
      );
      return { ...current, snapshot, decisions, replayed: false };
    });
    if (!record.replayed)
      this.launch(
        record,
        credentials,
        JSON.stringify(input.answers),
        input.expectedRunId,
      );
    return record.snapshot;
  },
  async submit(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    identity: { runId: string; toolCallId: string },
    body: unknown,
    source?: string,
  ) {
    const input = submitDatasetSchema.parse(body),
      record = await retrievalStore.get(id, owner);
    let recipe = input.recipe;
    if (input.path) {
      if (!input.executionId || source === undefined)
        throw new HttpError(400, "A tested file receipt is required");
      const receipt = codeExecutionSchema.parse(
        await new RuntimeClient(owner.domainId).request(
          `/v1/code-executions/${input.executionId}`,
        ),
      );
      if (
        receipt.runId !== identity.runId ||
        receipt.status !== "completed" ||
        receipt.sourceSha256 !== sha(source)
      )
        throw new HttpError(
          409,
          "Program changed or was not successfully tested in this run",
        );
      recipe = { kind: "python", code: source, sha256: sha(source) };
    }
    if (!recipe || (recipe.kind === "python" && !input.path))
      throw new HttpError(400, "Python requires a tested workspace file");
    if (
      input.decisionIds.some(
        (id) =>
          !record.decisions.some(
            (d) =>
              d.id === id &&
              !record.decisions.some((next) => next.supersedesId === id),
          ),
      )
    )
      throw new HttpError(400, "Unknown or superseded decision");
    const hash = fingerprint({ input, recipe });
    const submission = await transaction(async (c) => {
      await retrievalStore.gate(id, owner, identity.runId, c);
      const round = await c.query(
        `SELECT submission FROM ${table("retrieval_rounds")} WHERE id=$1`,
        [identity.runId],
      );
      if (round.rows[0].submission)
        throw new HttpError(409, "Retrieval outcome was already submitted");
      const old = await c.query(
        `SELECT * FROM ${table("retrieval_submissions")} WHERE run_id=$1 AND tool_call_id=$2`,
        [identity.runId, identity.toolCallId],
      );
      if (old.rows[0]) {
        if (old.rows[0].input_hash !== hash)
          throw new HttpError(409, "Submission input changed");
        return old.rows[0];
      }
      const submissionId = randomUUID();
      await c.query(
        `INSERT INTO ${table("retrieval_submissions")} (id,run_id,tool_call_id,input_hash) VALUES($1,$2,$3,$4)`,
        [submissionId, identity.runId, identity.toolCallId, hash],
      );
      return { id: submissionId, payload: null };
    });
    let payload = submission.payload as DatasetPayload | null;
    if (!payload) {
      await ontologyRequest("/ontology/query/outputs", credentials, {
        submissionId: submission.id,
        recipe,
        outKeyRefs: input.outKeyRefs,
      });
      let result;
      while (true) {
        const round = await retrievalStore.round(identity.runId);
        if (!round.open || Date.now() > new Date(round.deadline).getTime())
          throw new HttpError(409, "Retrieval round is closed or expired");
        result = await ontologyRequest(
          `/ontology/query/outputs/${submission.id}`,
          credentials,
        );
        if (result.status !== "running") break;
        await pause(200);
      }
      if (result.status !== "completed")
        throw new Error(
          result.error?.message ?? "Final output did not complete",
        );
      const { receiptId, executedAt, ...output } = result.result;
      payload = datasetPayloadSchema.parse({
        title: input.title,
        question: input.question,
        ...output,
        assumptions: input.assumptions,
        metricUses: input.metricUses,
        selfCheck: input.selfCheck,
        decisionIds: input.decisionIds,
        execution: { receiptId, executedAt },
      });
      await transaction(async (c) => {
        await retrievalStore.gate(id, owner, identity.runId, c);
        await c.query(
          `UPDATE ${table("retrieval_submissions")} SET payload=$2 WHERE id=$1`,
          [submission.id, payload],
        );
      });
    }
    return {
      result: {
        submissionId: submission.id,
        title: payload.title,
        rowCount: payload.rows.length,
        truncation: payload.truncation,
      },
      artifacts: [
        { content: { type: "workbench.dataset.v1", payload }, references: [] },
      ],
    };
  },
  async finish(
    id: string,
    owner: RetrievalOwner,
    runId: string,
    body: unknown,
  ) {
    const input = finishRetrievalSchema.parse(body);
    if (input.status === "completed" && !input.submissionIds.length)
      throw new HttpError(400, "Completed retrieval requires a dataset");
    if (input.status === "needs_input" && !input.questions?.length)
      throw new HttpError(400, "Needs-input requires questions");
    if (input.status === "failed" && !input.error)
      throw new HttpError(400, "Failure requires a reason");
    return transaction(async (c) => {
      await retrievalStore.gate(id, owner, runId, c);
      const rows = await c.query(
        `SELECT id FROM ${table("retrieval_submissions")} WHERE run_id=$1 AND payload IS NOT NULL`,
        [runId],
      );
      if (input.submissionIds.some((id) => !rows.rows.some((r) => r.id === id)))
        throw new HttpError(400, "Unknown dataset submission");
      const current = await c.query(
        `SELECT submission FROM ${table("retrieval_rounds")} WHERE id=$1`,
        [runId],
      );
      if (current.rows[0].submission)
        throw new HttpError(409, "Outcome already submitted");
      const submission = {
        ...input,
        questions: input.questions?.map((q) => ({ ...q, id: randomUUID() })),
      };
      await c.query(
        `UPDATE ${table("retrieval_rounds")} SET submission=$2 WHERE id=$1`,
        [runId, submission],
      );
      return {
        result: { accepted: true, status: input.status },
        artifacts: [],
      };
    });
  },
  dataset: artifact,
  async cancelParent(
    parentId: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
  ) {
    const ids = await retrievalStore.cancelParent(parentId, owner);
    await Promise.all(ids.map((id) => this.cancel(id, owner, credentials)));
  },
  async quality(record: RetrievalRecord, credentials: RetrievalCredentials) {
    const runId = record.snapshot.runtimeRunId!;
    if (qualityActive.has(runId)) return;
    qualityActive.add(runId);
    try {
      const round = await retrievalStore.round(runId);
      if (round.qc_result) return;
      const qcId = await transaction(async (c) => {
        const current = await c.query(
          `SELECT qc_result FROM ${table("retrieval_rounds")} WHERE id=$1 FOR UPDATE`,
          [runId],
        );
        if (current.rows[0].qc_result) return null;
        await c.query(
          `UPDATE ${table("retrieval_rounds")} SET qc_id=$2 WHERE id=$1 AND qc_id IS NULL`,
          [runId, randomUUID()],
        );
        const result = await c.query(
          `SELECT qc_id FROM ${table("retrieval_rounds")} WHERE id=$1`,
          [runId],
        );
        return result.rows[0].qc_id as string;
      });
      if (!qcId) return;
      const committed = await getPostgresPool().query(
        `SELECT artifact_id FROM ${table("retrieval_submissions")} WHERE run_id=$1 AND artifact_id IS NOT NULL ORDER BY id`,
        [runId],
      );
      const datasets = await Promise.all(
        committed.rows.map((row) => artifact(record.owner, row.artifact_id)),
      );
      const programs = datasets.map(({ payload: p }) => ({
        question: p.question,
        code:
          p.recipe.kind === "python"
            ? p.recipe.code
            : p.recipe.kind === "metric"
              ? p.recipe.executedCode
              : undefined,
        outKeyRefs: p.outKeyRefs,
      }));
      // Java owns the DSL-to-program conversion; repeated admission never repeats a check.
      let result = await ontologyRequest("/query-quality-checks", credentials, {
        id: qcId,
        question: record.input.question,
        programs,
        recipes: datasets.map((d) => d.payload.recipe),
        classNames: record.input.classNames ?? [],
      });
      const deadline = Date.now() + 60000;
      while (result.status === "running" && Date.now() < deadline) {
        await pause(500);
        result = await ontologyRequest(
          `/query-quality-checks/${qcId}`,
          credentials,
        );
      }
      if (result.status === "running")
        result = await ontologyRequest(
          `/query-quality-checks/${qcId}/cancel`,
          credentials,
          {},
        );
      await getPostgresPool().query(
        `UPDATE ${table("retrieval_rounds")} SET qc_result=$2 WHERE id=$1 AND qc_id=$3 AND qc_result IS NULL`,
        [runId, result, qcId],
      );
      const checked = result.result;
      const steps = (checked?.programDescriptions ?? []).map(
        (item: Record<string, unknown>) => ({
          ...(typeof item.summary === "string"
            ? { summary: item.summary }
            : {}),
          ...(typeof item.meaning === "string"
            ? { meaning: item.meaning }
            : {}),
        }),
      );
      const qcResult = checked
        ? {
            steps,
            score: checked.score,
            conclusion: checked.conclusion,
            fittedQuestion: checked.fittedQuestion,
          }
        : null;
      const qcState = {
        status: result.status === "completed" ? "completed" : "failed",
        steps: steps.map((step: Record<string, unknown>) => ({
          ...step,
          status: "done",
          timestamp: Date.now(),
        })),
        ...(qcResult ? { result: qcResult } : {}),
      };
      await getPostgresPool().query(
        `UPDATE ${table("query_runs")} SET qc_result=$2,qc_state=$3 WHERE retrieval_ref->>'runtimeRunId'=$1`,
        [runId, qcResult, qcState],
      );
    } finally {
      qualityActive.delete(runId);
    }
  },
};
