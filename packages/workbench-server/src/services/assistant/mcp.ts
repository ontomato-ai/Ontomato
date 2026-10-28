import { randomUUID } from "node:crypto";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { assistantStore, type AssistantOwner } from "./store";
import { assistantService } from "./service";
import {
  messageText,
  finalText,
  type AssistantCredentials,
} from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
export async function analysisTask(id: string, owner: AssistantOwner) {
  const turn = await assistantStore.turn(id, owner),
    session = await assistantStore.session(turn.session_id, owner),
    s = await assistantService.readRun(session.id, id, owner),
    report = s.artifacts
      .filter((a) => /^outputs\/reports\/.+\/report\.md$/.test(a.path))
      .at(-1),
    text = finalText(s);
  return {
    id,
    agentId: session.agent_id,
    userId: owner.userId,
    name: session.title,
    status:
      s.run.status === "running"
        ? "running"
        : s.run.stopReason === "stop"
          ? "completed"
          : s.run.stopReason === "aborted"
            ? "cancelled"
            : "failed",
    threadId:
      (
        await getPostgresPool().query(
          `SELECT alias FROM ${table("assistant_external_threads")} WHERE session_id=$1 AND domain_id=$2 AND owner_id=$3 ORDER BY alias LIMIT 1`,
          [session.id, owner.domainId, owner.userId],
        )
      ).rows[0]?.alias ?? session.id,
    question: messageText(
      s.messages.find((m) => m.message.role === "user")?.message ?? {
        content: "",
      },
    ),
    resultSummary: text,
    resultReport: report
      ? (
          await assistantService.content(session.id, report.id, owner)
        ).toString()
      : undefined,
    reportDeliverableEnabled: !!report,
    finalAnswer: text,
    triggerSource: "manual",
    lastRunAt: Date.parse(s.run.createdAt),
    createdAt: new Date(turn.created_at).getTime(),
    updatedAt: Date.parse(s.run.finishedAt ?? s.run.createdAt),
  };
}
export async function startAnalysis(
  agentId: string,
  message: string,
  threadId: string | undefined,
  owner: AssistantOwner,
  credentials: AssistantCredentials,
) {
  let sessionId: string;
  if (threadId && /^[a-f0-9-]{36}$/i.test(threadId)) {
    const s = await assistantStore.session(threadId, owner);
    if (s.agent_id !== agentId)
      throw new HttpError(409, "Conversation agent differs");
    sessionId = s.id;
  } else if (threadId) {
    const result = await getPostgresPool().query(
      `INSERT INTO ${table("assistant_external_threads")} (domain_id,owner_id,alias,session_id) VALUES($1,$2,$3,$4) ON CONFLICT(domain_id,owner_id,alias) DO UPDATE SET alias=EXCLUDED.alias RETURNING session_id`,
      [owner.domainId, owner.userId, threadId, randomUUID()],
    );
    sessionId = result.rows[0].session_id;
    await assistantService.create(sessionId, owner, {
      agentId,
    });
  } else {
    sessionId = randomUUID();
    await assistantService.create(sessionId, owner, {
      agentId,
    });
  }
  const runId = randomUUID();
  await assistantService.start(sessionId, runId, message, owner, credentials);
  const task = await analysisTask(runId, owner);
  return { ...task, threadId: threadId ?? sessionId };
}
