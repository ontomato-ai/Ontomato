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
  answerText,
  type AssistantCredentials,
} from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { runOutcome } from "../../platform/agent-runtime/projection";

async function externalThreadId(sessionId: string, owner: AssistantOwner): Promise<string> {
  return (
    (
      await getPostgresPool().query(
        `SELECT alias FROM ${table("assistant_external_threads")} WHERE session_id=$1 AND domain_id=$2 AND owner_id=$3 ORDER BY alias LIMIT 1`,
        [sessionId, owner.domainId, owner.userId],
      )
    ).rows[0]?.alias ?? sessionId
  );
}

async function pendingAnalysisTask(id: string, owner: AssistantOwner, notFound: HttpError) {
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  let intent;
  try {
    intent = await client.channelIntent(id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw notFound;
    throw error;
  }
  if (intent.session.providerId !== "workbench" || intent.channel.actor.domainId !== owner.domainId)
    throw notFound;
  const session = await assistantStore.session(intent.session.sessionId, owner);
  if (intent.status !== "starting" && intent.status !== "cancelled" && intent.status !== "failed")
    return null;
  const snapshot = await client.session(session.id);
  const input = snapshot.messages.find((m) => m.id === intent.inputId)?.message;
  const createdAt = Date.parse(intent.createdAt);
  return {
    id,
    agentId: session.agent_id,
    userId: owner.userId,
    name: session.title,
    status: intent.status,
    threadId: await externalThreadId(session.id, owner),
    question: messageText(input ?? { content: "" }),
    resultSummary: intent.error ?? "",
    resultReport: undefined,
    reportDeliverableEnabled: false,
    finalAnswer: "",
    triggerSource: "manual" as const,
    lastRunAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function analysisTask(id: string, owner: AssistantOwner) {
  if (!z.string().uuid().safeParse(id).success)
    throw new HttpError(404, "Analysis task not found");
  let turn;
  let session;
  let s;
  try {
    turn = await assistantStore.turn(id, owner);
    session = await assistantStore.session(turn.session_id, owner);
    s = await assistantService.readRun(session.id, id, owner);
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error;
    const pending = await pendingAnalysisTask(id, owner, error);
    if (pending) return pending;
    turn = await assistantStore.turn(id, owner);
    session = await assistantStore.session(turn.session_id, owner);
    s = await assistantService.readRun(session.id, id, owner);
  }
  const report = s.artifacts
      .filter((a) => /^outputs\/reports\/.+\/report\.md$/.test(a.path))
      .at(-1),
    text = answerText(s);
  return {
    id,
    agentId: session.agent_id,
    userId: owner.userId,
    name: session.title,
    status: runOutcome(s.run),
    threadId: await externalThreadId(session.id, owner),
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
    triggerSource: "manual" as const,
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
    await assistantService.create(sessionId, owner, { agentId }, credentials);
  } else if (!sessionId) {
    sessionId = randomUUID();
    await assistantService.create(sessionId, owner, { agentId }, credentials);
  }
  const runId = randomUUID();
  const { delivery } = await assistantService.send(sessionId, runId, {message}, owner, credentials, "external");
  if (delivery.status === "starting") {
    return {
      id: delivery.runId,
      agentId,
      userId: owner.userId,
      threadId: threadId ?? sessionId,
      question: message,
      status: delivery.status,
    };
  }
  const task = await analysisTask(delivery.runId, owner);
  return { ...task, threadId: threadId ?? sessionId };
}
