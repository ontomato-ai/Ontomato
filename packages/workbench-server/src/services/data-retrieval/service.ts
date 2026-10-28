import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  datasetPayloadSchema,
  prepareDatasetSchema,
  retrievalAnswersSchema,
  type RetrievalInput,
  type RetrievalSnapshot,
} from "@ontomato/contracts/data-retrieval";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { renderPrompt } from "../../core/prompts/loader";
import { getQueryTimeoutMs } from "../../config/query-settings";
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
const logger = createLogger("data-retrieval"),
  active = new Map<string, Promise<void>>(),
  preparing = new Map<string, Promise<void>>(),
  qualityActive = new Set<string>();
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function artifact(
  owner: RetrievalOwner,
  id: string,
  retrievalId?: string,
) {
  const rows = await getPostgresPool().query(
    `SELECT 1 FROM ${table("retrieval_submissions")} s JOIN ${table("retrieval_rounds")} t ON t.id=s.run_id JOIN ${table("retrievals")} r ON r.id=t.retrieval_id WHERE s.artifact_id=$1 AND r.domain_id=$2 AND r.owner_id=$3${retrievalId ? " AND r.id=$4" : ""}`,
    [id, owner.domainId, owner.userId, ...(retrievalId ? [retrievalId] : [])],
  );
  if (!rows.rowCount) throw new HttpError(404, "Dataset not found");
  const client = new RuntimeClient(owner.domainId);
  runtimeArtifactSchema.parse(await client.request(`/v1/artifacts/${id}`));
  return {
    id,
    payload: datasetPayloadSchema.parse(
      JSON.parse(await client.text(`/v1/artifacts/${id}/content`)),
    ),
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
    const accepted = await retrievalStore.create(
      id,
      owner,
      input,
      parentId,
      new Date(Date.now() + getQueryTimeoutMs()),
    );
    if (!accepted.replayed) await this.launch(accepted.record, credentials);
    else await preparing.get(accepted.record.currentRunId);
    return (await retrievalStore.get(id, owner)).snapshot;
  },
  launch(
    record: RetrievalRecord,
    credentials: RetrievalCredentials,
    answer?: string,
  ) {
    const runId = record.currentRunId;
    if (active.has(runId)) return preparing.get(runId) ?? Promise.resolve();
    const ready = this.prepare(record, credentials, answer).catch(
      async (error) => {
        // An uncertain admission is reconciled by its original ID before closing a gate.
        try {
          await new RuntimeClient(record.owner.domainId).run(runId);
          return;
        } catch (readError) {
          if (readError instanceof HttpError && readError.status === 404)
            await retrievalStore.close(
              record.snapshot.id,
              record.owner,
              runId,
              { ...record.snapshot, run: null },
            );
        }
        throw error;
      },
    );
    preparing.set(runId, ready);
    const work = ready
      .then(() =>
        this.observe(record.snapshot.id, record.owner, credentials, runId),
      )
      .catch((error) =>
        logger.error(
          "Retrieval admission or observation requires reconciliation",
          { runId, error },
        ),
      )
      .finally(() => {
        active.delete(runId);
        preparing.delete(runId);
      });
    active.set(runId, work);
    return ready;
  },
  async prepare(
    record: RetrievalRecord,
    credentials: RetrievalCredentials,
    answer?: string,
  ) {
    const { owner, input, snapshot, currentRunId: runId } = record,
      client = new RuntimeClient(owner.domainId, runId),
      round = await retrievalStore.round(runId);
    await client.createSession(record.workSessionId);
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
    const items = z
      .object({ items: z.array(z.record(z.unknown())) })
      .passthrough();
    items.parse(knowledge);
    items.parse(metrics);
    const grant = z
      .object({
        credential: z.object({
          kind: z.literal("bearer"),
          value: z.string().min(1),
        }),
        expiresAt: z.string().datetime(),
      })
      .parse(
        await ontologyRequest(
          "/internal/query-grants/exploration",
          credentials,
          {
            retrievalId: snapshot.id,
            runtimeSessionId: record.workSessionId,
            runtimeRunId: runId,
            expiresAt: new Date(round.deadline).toISOString(),
            classNames: input.classNames ?? [],
          },
        ),
      );
    const deadline = Math.min(
      new Date(round.deadline).getTime(),
      Date.parse(grant.expiresAt),
    );
    await getPostgresPool().query(
      `UPDATE ${table("retrieval_rounds")} SET deadline=LEAST(deadline,$2) WHERE id=$1`,
      [runId, new Date(deadline)],
    );
    const prior = await Promise.all(
      [
        ...new Set([
          ...input.previousDatasetIds,
          ...snapshot.datasetArtifactIds,
        ]),
      ].map((id) => artifact(owner, id)),
    );
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
      answer: answer ?? null,
    };
    await transaction((c) => retrievalStore.gate(snapshot.id, owner, runId, c));
    await client.start(record.workSessionId, runId, {
      language: credentials.locale ?? "en",
      input: {
        role: "user",
        content: JSON.stringify(context),
        timestamp: Date.now(),
      },
      definition: {
        systemPrompt:
          renderPrompt("data-retrieval.system", {}, credentials.locale) +
          "\n\n" +
          ARTIFACT_MARKDOWN_PROMPT,
        modelRole: "coding",
        skills: [ontologySkill, retrievalSkill],
        externalMcp: [],
        sandbox: {
          limits: codeLimitsSchema.parse({
            memoryBytes: 16 * 1024 ** 3,
            wallTimeMs: Math.max(1, deadline - Date.now()),
            cpuSeconds: Math.max(1, Math.ceil(getQueryTimeoutMs() / 1000)),
          }),
        },
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
      modelCredential: credentials.apiKey
        ? { kind: "api_key", value: credentials.apiKey }
        : credentials.token
          ? { kind: "token", value: credentials.token }
          : { kind: "none" },
      environment: {
        values: {
          ONTOMATO_ONTOLOGY_URL: getApiConfig().baseUrl!,
          ONTOMATO_WORKBENCH_URL: environment
            .agentRuntime()
            .callbackUrl.replace(/\/$/, ""),
          ONTOMATO_RETRIEVAL_ID: snapshot.id,
        },
        secrets: {
          ONTOMATO_QUERY_TK: grant.credential.value,
          ONTOMATO_TK: callbackCredential({
            pathPrefix: `/api/retrievals/${snapshot.id}/runs/${runId}/`,
            runId,
            expiresAt: deadline,
            token: credentials.token ?? "",
            apiKey: credentials.apiKey ?? "",
          }).value,
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
    let unavailable = false;
    const client = new RuntimeClient(owner.domainId);
    while (true) {
      const record = await retrievalStore.get(id, owner);
      if (
        record.currentRunId !== expectedRunId ||
        record.external ||
        record.snapshot.run?.status === "stopped"
      )
        return;
      let snapshot: RuntimeRunSnapshot;
      try {
        snapshot = await client.run(expectedRunId);
        unavailable = false;
      } catch (error) {
        if (!unavailable)
          logger.warn("Runtime observation awaits reconciliation", {
            id,
            runId: expectedRunId,
            error,
          });
        unavailable = true;
        await pause(1000);
        continue;
      }
      await this.reconcile(record, credentials, snapshot);
      if (snapshot.run.status === "stopped") return;
      if (
        Date.now() >
        new Date((await retrievalStore.round(expectedRunId)).deadline).getTime()
      ) {
        await this.cancel(id, owner, credentials);
        return;
      }
      await pause(500);
    }
  },
  async reconcile(
    record: RetrievalRecord,
    credentials: RetrievalCredentials,
    snapshot: RuntimeRunSnapshot,
  ) {
    const runId = record.currentRunId,
      client = new RuntimeClient(record.owner.domainId),
      accepted = new Map<string, string>();
    for (const file of snapshot.artifacts) {
      if (!file.path.endsWith(".dataset.json")) continue;
      const text = await client.text(`/v1/artifacts/${file.id}/content`);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      const parsed = datasetPayloadSchema.safeParse(value);
      if (!parsed.success) continue;
      const result = await getPostgresPool().query(
        `SELECT id FROM ${table("retrieval_submissions")} WHERE run_id=$1 AND receipt_id=$2 AND dataset_digest=$3`,
        [runId, parsed.data.execution.receiptId, fingerprint(parsed.data)],
      );
      if (result.rowCount) {
        await getPostgresPool().query(
          `UPDATE ${table("retrieval_submissions")} SET artifact_id=$2 WHERE id=$1`,
          [result.rows[0].id, file.id],
        );
        accepted.set(file.path, file.id);
      }
    }
    const next: RetrievalSnapshot = {
      ...record.snapshot,
      revision: record.snapshot.revision + 1,
      run: {
        status: snapshot.run.status,
        stopReason: snapshot.run.stopReason,
        errorMessage: snapshot.run.errorMessage,
      },
      messages: snapshot.messages,
      datasetArtifactIds: [...accepted.values()],
    };
    await transaction(async (c) => {
      const current = await retrievalStore.get(
        record.snapshot.id,
        record.owner,
        c,
        true,
      );
      if (current.currentRunId !== runId) return;
      if (snapshot.run.status === "stopped")
        await c.query(
          `UPDATE ${table("retrieval_rounds")} SET open=false WHERE id=$1`,
          [runId],
        );
      await c.query(
        `UPDATE ${table("retrievals")} SET snapshot=$2 WHERE id=$1`,
        [record.snapshot.id, { ...next, messages: [] }],
      );
    });
    if (snapshot.run.status === "stopped") {
      await ontologyRequest("/internal/query-grants/revoke", credentials, {
        runtimeRunId: runId,
      }).catch((error) =>
        logger.warn("Grant revocation awaits expiry", { runId, error }),
      );
      if (snapshot.run.stopReason === "stop" && next.datasetArtifactIds.length)
        void this.quality({ ...record, snapshot: next }, credentials).catch(
          (error) => logger.warn("Quality check failed", { runId, error }),
        );
    }
    return next;
  },
  async get(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
  ) {
    const r = await retrievalStore.get(id, owner);
    if (
      !r.external &&
      r.snapshot.run?.status !== "stopped" &&
      !active.has(r.currentRunId)
    ) {
      const work = this.observe(id, owner, credentials, r.currentRunId)
        .catch((error) =>
          logger.error("Recovery observation failed", { id, error }),
        )
        .finally(() => active.delete(r.currentRunId));
      active.set(r.currentRunId, work);
    }
    const round = await retrievalStore.round(r.currentRunId);
    if (
      !r.external &&
      r.snapshot.run?.status === "stopped" &&
      r.snapshot.run.stopReason === "stop" &&
      r.snapshot.datasetArtifactIds.length &&
      !round.qc_result
    )
      void this.quality(r, credentials).catch((error) =>
        logger.warn("Quality recovery failed", { id, error }),
      );
    let messages = r.snapshot.messages;
    if (!r.external && r.snapshot.run) {
      try {
        messages = (await new RuntimeClient(owner.domainId).run(r.currentRunId))
          .messages;
      } catch (error) {
        logger.debug("Retrieval messages await runtime transport", {
          id,
          error,
        });
      }
    }
    return {
      ...r.snapshot,
      messages,
      ...(round.qc_result ? { qualityCheck: round.qc_result } : {}),
    };
  },
  async cancel(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
  ) {
    const r = await retrievalStore.get(id, owner),
      runId = r.currentRunId;
    await retrievalStore.close(id, owner, runId);
    const pending = (
      await getPostgresPool().query(
        `SELECT id FROM ${table("retrieval_submissions")} WHERE run_id=$1`,
        [runId],
      )
    ).rows;
    const round = await retrievalStore.round(runId);
    const requests: Promise<unknown>[] = [
      ...pending.map((s) =>
        ontologyRequest(
          `/ontology/query/outputs/${s.id}/cancel`,
          credentials,
          {},
        ),
      ),
      ...(round.qc_id
        ? [
            ontologyRequest(
              `/query-quality-checks/${round.qc_id}/cancel`,
              credentials,
              {},
            ),
          ]
        : []),
    ];
    if (!r.external)
      requests.push(
        new RuntimeClient(owner.domainId).request(
          `/v1/sessions/${r.workSessionId}/run-intents/${runId}/cancel`,
          "POST",
          {},
        ),
        ontologyRequest("/internal/query-grants/revoke", credentials, {
          runtimeRunId: runId,
        }),
      );
    const settled = await Promise.allSettled(requests);
    for (const result of settled)
      if (result.status === "rejected")
        logger.warn("Cancellation requires reconciliation", {
          runId,
          error: result.reason,
        });
    if (!r.external)
      try {
        return await this.reconcile(
          r,
          credentials,
          await new RuntimeClient(owner.domainId).run(runId),
        );
      } catch (error) {
        logger.warn("Cancelled run awaits runtime snapshot", { runId, error });
      }
    return (await retrievalStore.get(id, owner)).snapshot;
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
    const result = await this.openRound(id, owner, key, hash, input);
    if (!result.replayed)
      await this.launch(result.record, credentials, input.message);
    else await preparing.get(result.record.currentRunId);
    return result.record.snapshot;
  },
  async openRound(
    id: string,
    owner: RetrievalOwner,
    key: string,
    hash: string,
    input?: z.infer<typeof retrievalAnswersSchema>,
  ) {
    return transaction(async (c) => {
      const current = await retrievalStore.get(id, owner, c, true);
      if (current.parentId) {
        const row = (
          await c.query(
            `SELECT closed FROM ${table("retrieval_parent_gates")} WHERE domain_id=$1 AND owner_id=$2 AND parent_id=$3 FOR UPDATE`,
            [owner.domainId, owner.userId, current.parentId],
          )
        ).rows[0];
        if (row?.closed) throw new HttpError(409, "Parent run is closed");
      }
      const old = (
        await c.query(
          `SELECT request_hash FROM ${table("retrieval_rounds")} WHERE id=$1 AND retrieval_id=$2`,
          [key, id],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash)
          throw new HttpError(409, "Reply input changed");
        return { record: current, replayed: true };
      }
      if (
        input &&
        (current.external ||
          current.snapshot.run?.status !== "stopped" ||
          current.currentRunId !== input.expectedRunId ||
          current.snapshot.decisionRevision !== input.expectedDecisionRevision)
      )
        throw new HttpError(
          409,
          "Retrieval round or decision revision changed",
        );
      if (!input && !current.external)
        throw new HttpError(
          409,
          "External begin requires an external work record",
        );
      const decisions = input
        ? [
            ...current.decisions,
            {
              id: randomUUID(),
              runId: input.expectedRunId,
              text: input.message,
              scope: "task",
              source: "user" as const,
              supersedesId: null,
            },
          ]
        : current.decisions;
      const snapshot: RetrievalSnapshot = {
        ...current.snapshot,
        runtimeRunId: current.external ? null : key,
        run: current.external
          ? null
          : { status: "running", stopReason: null, errorMessage: null },
        messages: [],
        revision: current.snapshot.revision + 1,
        decisionRevision: current.snapshot.decisionRevision + (input ? 1 : 0),
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
        `UPDATE ${table("retrievals")} SET current_run_id=$2,snapshot=$3,decisions=$4 WHERE id=$1`,
        [id, key, snapshot, JSON.stringify(decisions)],
      );
      return {
        record: { ...current, currentRunId: key, snapshot, decisions },
        replayed: false,
      };
    });
  },
  async begin(
    id: string,
    owner: RetrievalOwner,
    input: RetrievalInput,
    existingId?: string,
  ) {
    const result = existingId
      ? await this.openRound(
          existingId,
          owner,
          id,
          fingerprint({ input, existingId }),
        )
      : await retrievalStore.create(
          id,
          owner,
          input,
          null,
          new Date(Date.now() + getQueryTimeoutMs()),
          true,
        );
    const r = result.record,
      round = await retrievalStore.round(id);
    return {
      id: r.snapshot.id,
      sessionId: r.workSessionId,
      runId: id,
      expiresAt: new Date(round.deadline).toISOString(),
    };
  },
  async prepareOutput(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    runId: string,
    key: string,
    body: unknown,
  ) {
    const input = prepareDatasetSchema.parse(body),
      hash = fingerprint(input),
      r = await retrievalStore.get(id, owner);
    if (
      input.recipe.kind === "python" &&
      createHash("sha256").update(input.recipe.code).digest("hex") !==
        input.recipe.sha256
    )
      throw new HttpError(400, "Recipe source digest mismatch");
    if (
      input.decisionIds.some(
        (d) =>
          !r.decisions.some(
            (x) =>
              x.id === d &&
              !r.decisions.some((next) => next.supersedesId === d),
          ),
      )
    )
      throw new HttpError(400, "Unknown decision");
    await transaction(async (c) => {
      await retrievalStore.gate(id, owner, runId, c);
      const old = (
        await c.query(
          `SELECT run_id,input_hash FROM ${table("retrieval_submissions")} WHERE id=$1`,
          [key],
        )
      ).rows[0];
      if (old) {
        if (old.run_id !== runId || old.input_hash !== hash)
          throw new HttpError(409, "Output input changed");
        return;
      }
      await c.query(
        `INSERT INTO ${table("retrieval_submissions")} (id,run_id,input_hash,request) VALUES($1,$2,$3,$4)`,
        [key, runId, hash, input],
      );
    });
    await ontologyRequest("/ontology/query/outputs", credentials, {
      submissionId: key,
      recipe: input.recipe,
      outKeyRefs: input.outKeyRefs,
    });
    return { id: key };
  },
  async output(
    id: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
    runId: string,
    key: string,
  ) {
    await retrievalStore.get(id, owner);
    const row = (
      await getPostgresPool().query(
        `SELECT s.* FROM ${table("retrieval_submissions")} s JOIN ${table("retrieval_rounds")} r ON r.id=s.run_id WHERE s.id=$1 AND s.run_id=$2 AND r.retrieval_id=$3`,
        [key, runId, id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Output not found");
    const result = await ontologyRequest(
      `/ontology/query/outputs/${key}`,
      credentials,
    );
    if (result.status === "running")
      return { id: key, running: true, dataset: null, error: null };
    if (result.status !== "completed")
      return {
        id: key,
        running: false,
        dataset: null,
        error: result.error ?? {
          code: "OUTPUT_FAILED",
          message: "Final output did not complete",
        },
      };
    const { receiptId, executedAt, ...data } = result.result;
    const dataset = datasetPayloadSchema.parse({
      ...row.request,
      ...data,
      schema: "workbench.dataset.v1",
      execution: { receiptId, executedAt },
    });
    await transaction(async (c) => {
      if (!row.dataset_digest) await retrievalStore.gate(id, owner, runId, c);
      await c.query(
        `UPDATE ${table("retrieval_submissions")} SET dataset_digest=$2,receipt_id=$3 WHERE id=$1`,
        [key, fingerprint(dataset), receiptId],
      );
    });
    return { id: key, running: false, dataset, error: null };
  },
  dataset: artifact,
  async cancelParent(
    parentId: string,
    owner: RetrievalOwner,
    credentials: RetrievalCredentials,
  ) {
    await Promise.all(
      (await retrievalStore.cancelParent(parentId, owner)).map((id) =>
        this.cancel(id, owner, credentials),
      ),
    );
  },
  async quality(record: RetrievalRecord, credentials: RetrievalCredentials) {
    const runId = record.currentRunId;
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
