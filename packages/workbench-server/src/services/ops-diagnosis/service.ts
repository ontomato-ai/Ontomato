import { lockSessionClaim, assertUnclaimedSession } from "../agent-host/session-claim";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { DIAGNOSIS_AGENT_ID, diagnosisTargetSchema, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { ARTIFACT_MARKDOWN_PROMPT } from "@ontomato/contracts/agent-artifact-markdown";
import { runtimeArtifactSchema } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import { getPostgresPool, qualifiedTable as table } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { publicMessages, publicRun, publicSnapshot, runStatusView } from "../../platform/agent-runtime/projection";
import { runDefinition, messageText } from "../../platform/agent-runtime/runtime";
import { workbenchServerResourceRoot } from "../../content/resources";
import { renderPrompt } from "../../core/prompts/loader";
import { environment } from "../../config/environment";
import { publishSkill } from "../agent-runtime/skills";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { HttpError } from "../../utils/errors";
import type { AgentHostOwner, AgentHostService } from "../agent-host/types";

type Session = { id: string; domain_id: string; owner_id: string; title: string; target: DiagnosisTarget | null; created_at: Date; updated_at: Date };
const db = getPostgresPool;
const skill = { namespace: { kind: "provider" as const, provider: "workbench" }, name: "ops-diagnosis" };
const missing = () => new HttpError(404, "Conversation not found", "NOT_FOUND");
export async function diagnosisSession(id: string, owner: AgentHostOwner): Promise<Session> {
  const row = (await db().query(`SELECT * FROM ${table("ops_sessions")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`, [id, owner.domainId, owner.userId])).rows[0];
  if (!row) throw missing();
  return row;
}
type LatestRun = Parameters<typeof runStatusView>[0];
const view = (s: Session, latest: LatestRun | null) => ({
  id: s.id, agentId: DIAGNOSIS_AGENT_ID, title: s.title,
  createdAt: new Date(s.created_at).toISOString(), updatedAt: new Date(s.updated_at).toISOString(),
  latestRun: latest ? runStatusView(latest) : null,
});
export async function createDiagnosis(id: string, owner: AgentHostOwner, target: DiagnosisTarget | null = null) {
  if (target) target = diagnosisTargetSchema.parse(target);
  const inserted = await transaction(async (tx) => {
    await lockSessionClaim(tx, id);
    const previous = await tx.query(`SELECT id FROM ${table("ops_sessions")} WHERE id=$1`, [id]);
    if (previous.rowCount) return { rowCount: 0 };
    await assertUnclaimedSession(tx, id, owner);
    return tx.query(`INSERT INTO ${table("ops_sessions")} (id,domain_id,owner_id,target) VALUES($1,$2,$3,$4)`, [id, owner.domainId, owner.userId, target ? JSON.stringify(target) : null]);
  });
  const row = await diagnosisSession(id, owner);
  if (canonical(row.target) !== canonical(target)) throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  await client.createSession(id);
  return { session: view(row, (await client.session(id)).latestRun?.run ?? null), replayed: !inserted.rowCount };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export const diagnosisService: AgentHostService = {
  async agents(_owner, locale) {
    const zh = locale?.startsWith("zh");
    return { agents: [{ id: DIAGNOSIS_AGENT_ID, name: zh ? "运维诊断" : "Operations diagnosis", description: zh ? "只读取证与故障诊断" : "Read evidence and diagnose faults", icon: "wrench", enabled: true }] };
  },
  async create(id, owner, input) {
    if (input.agentId !== DIAGNOSIS_AGENT_ID) throw missing();
    return createDiagnosis(id, owner);
  },
  async list(owner, input) {
    if (input.agentId !== DIAGNOSIS_AGENT_ID) throw missing();
    let cursor: { id: string; updatedAt: string } | undefined;
    if (input.cursor) {
      try { cursor = z.object({ id: z.string().uuid(), updatedAt: z.string().datetime() }).strict().parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString())); }
      catch { throw new HttpError(400, "Invalid session cursor", "INVALID_REQUEST"); }
    }
    const rows = (await db().query(`SELECT * FROM ${table("ops_sessions")} WHERE domain_id=$1 AND owner_id=$2 AND ($3::timestamptz IS NULL OR (updated_at,id)<($3,$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT $5`, [owner.domainId, owner.userId, cursor?.updatedAt ?? null, cursor?.id ?? null, input.limit + 1])).rows as Session[];
    const selected = rows.slice(0, input.limit), client = new RuntimeClient(owner.domainId);
    const statuses = selected.length ? await client.sessionStatuses(selected.map((row) => row.id)) : [];
    const sessions = selected.map((row) => view(row, statuses.find((s) => s.session.id === row.id)?.latestRun ?? null));
    const last = selected.at(-1);
    return { sessions, nextCursor: rows.length > input.limit && last ? Buffer.from(JSON.stringify({ id: last.id, updatedAt: new Date(last.updated_at).toISOString() })).toString("base64url") : null };
  },
  async history(id, owner, query) {
    const row = await diagnosisSession(id, owner), page = await new RuntimeClient(owner.domainId).history(id, query);
    const latest = page.session.latestRun;
    return { ...page, session: view(row, latest) };
  },
  async snapshot(id, owner) {
    const row = await diagnosisSession(id, owner), snapshot = await new RuntimeClient(owner.domainId).session(id);
    if (!row.title) {
      const first = snapshot.messages.find((m) => m.message.role === "user");
      if (first) { row.title = messageText(first.message); await db().query(`UPDATE ${table("ops_sessions")} SET title=$2 WHERE id=$1 AND title=''`, [id, row.title]); }
    }
    return { session: view(row, snapshot.latestRun?.run ?? null), messages: publicMessages(snapshot.messages), latestRun: snapshot.latestRun ? publicSnapshot(snapshot.latestRun) : null };
  },
  async readRun(session, run, owner) {
    await diagnosisSession(session, owner);
    const snapshot = await new RuntimeClient(owner.domainId).run(run);
    if (snapshot.run.sessionId !== session) throw missing();
    return snapshot;
  },
  async start(session, run, message, owner, credentials) {
    const row = await diagnosisSession(session, owner), client = new RuntimeClient(owner.domainId, undefined, owner.userId);
    const language = credentials.locale ?? "en";
    const fingerprint = createHash("sha256").update(canonical({ session, message, language })).digest("hex");
    const intent = await transaction(async (tx) => {
      await tx.query(`SELECT id FROM ${table("ops_sessions")} WHERE id=$1 FOR UPDATE`, [session]);
      const previous = (await tx.query(`SELECT * FROM ${table("ops_run_intents")} WHERE id=$1`, [run])).rows[0];
      if (previous) {
        if (previous.session_id !== session || previous.fingerprint !== fingerprint) throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
        return { ...previous, replayed: true };
      }
      const definition = runDefinition(renderPrompt("diagnosis-agent.main.system", {}, language) + "\n\n" + ARTIFACT_MARKDOWN_PROMPT + (row.target ? `\n\nDiagnosis target (resolve before drawing conclusions): ${JSON.stringify(row.target)}` : ""), "diagnosis", [skill], language);
      definition.agentId = DIAGNOSIS_AGENT_ID;
      return { ...(await tx.query(`INSERT INTO ${table("ops_run_intents")} (id,session_id,fingerprint,definition,language) VALUES($1,$2,$3,$4,$5) RETURNING *`, [run, session, fingerprint, JSON.stringify(definition), language])).rows[0], replayed: false };
    });
    if (intent.replayed) {
      try { return { snapshot: publicSnapshot(await this.readRun(session, run, owner)), replayed: true }; }
      catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
    }
    await publishSkill(path.join(workbenchServerResourceRoot, "resources/runtime-skills/ops-diagnosis"), skill);
    const definition = intent.definition as RuntimeStartRunRequest["definition"];
    const admitted = await client.start(session, run, {
      language: intent.language,
      input: { role: "user", content: message, timestamp: new Date(intent.created_at).getTime() },
      definition,
      environment: {
        values: { ONTOMATO_WORKBENCH_URL: environment.agentRuntime().callbackUrl.replace(/\/$/, "") },
        secrets: { ONTOMATO_TK: callbackCredential({ pathPrefix: "/api/observe/evidence/", runId: run, expiresAt: Date.now() + definition.sandbox.limits.wallTimeMs, token: credentials.token ?? "", apiKey: credentials.apiKey ?? "" }).value },
      },
    });
    await db().query(`UPDATE ${table("ops_sessions")} SET title=CASE WHEN title='' THEN $2 ELSE title END,updated_at=now() WHERE id=$1`, [session, message]);
    return { snapshot: publicSnapshot(await client.run(admitted.run.id)), replayed: admitted.replayed };
  },
  async cancel(session, run, owner) {
    await diagnosisSession(session, owner);
    const intent = (await db().query(`SELECT session_id FROM ${table("ops_run_intents")} WHERE id=$1`, [run])).rows[0];
    if (intent && intent.session_id !== session) throw missing();
    const client = new RuntimeClient(owner.domainId);
    let existingRun;
    try { existingRun = await client.run(run); }
    catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
    if (existingRun && existingRun.run.sessionId !== session) throw missing();
    await client.request(`/v1/sessions/${session}/run-intents/${run}/cancel`, "POST", {});
    try { return { run: publicRun((await this.readRun(session, run, owner)).run) }; }
    catch (e) { if (e instanceof HttpError && e.status === 404) return { run: null }; throw e; }
  },
  async delete(id, owner) {
    await diagnosisSession(id, owner);
    const client = new RuntimeClient(owner.domainId);
    try { await client.deleteSession(id); }
    catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
    await db().query(`DELETE FROM ${table("ops_sessions")} WHERE id=$1 AND domain_id=$2 AND owner_id=$3`, [id, owner.domainId, owner.userId]);
  },
  async artifact(session, id, owner) {
    await diagnosisSession(session, owner);
    const artifact = runtimeArtifactSchema.parse(await new RuntimeClient(owner.domainId).request(`/v1/artifacts/${id}`));
    if (artifact.sessionId !== session) throw missing();
    return artifact;
  },
  async content(session, id, owner) {
    await this.artifact(session, id, owner);
    return new RuntimeClient(owner.domainId).bytes(`/v1/artifacts/${id}/content`);
  },
  async resolve(session, run, filePath, owner) {
    await this.readRun(session, run, owner);
    const result = z.object({ artifacts: z.array(runtimeArtifactSchema) }).parse(await new RuntimeClient(owner.domainId).request(`/v1/runs/${run}/artifacts?path=${encodeURIComponent(filePath)}`));
    return { artifact: result.artifacts.at(-1) ?? null };
  },
};
