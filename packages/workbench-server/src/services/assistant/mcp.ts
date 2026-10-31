import { randomUUID } from "node:crypto";
import { z } from "zod";
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
import { runOutcome } from "../../platform/agent-runtime/projection";
export async function analysisTask(id: string, owner: AssistantOwner) {
  if (!z.string().uuid().safeParse(id).success)
    throw new HttpError(404, "Analysis task not found");
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
    status: runOutcome(s.run),
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
  let sessionId = "";
  if (threadId && z.string().uuid().safeParse(threadId).success) {
    try {
      const s = await assistantStore.session(threadId, owner);
      if (s.agent_id !== agentId)
        throw new HttpError(409, "Conversation agent differs");
      sessionId = s.id;
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
    }
  }
  if (!sessionId && threadId) {
    const result = await getPostgresPool().query(
      `INSERT INTO ${table("assistant_external_threads")} (domain_id,owner_id,alias,session_id) VALUES($1,$2,$3,$4) ON CONFLICT(domain_id,owner_id,alias) DO UPDATE SET alias=EXCLUDED.alias RETURNING session_id`,
      [owner.domainId, owner.userId, threadId, randomUUID()],
    );
    sessionId = result.rows[0].session_id;
    await assistantService.create(sessionId, owner, {
      agentId,
    });
  } else if (!sessionId) {
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
