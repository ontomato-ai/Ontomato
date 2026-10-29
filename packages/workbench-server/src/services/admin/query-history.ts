import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { readAssistantTurnEvidence } from "../assistant/evidence";
import { assistantStore } from "../assistant/store";
interface Filters {
  userId: string;
  domainId: string;
  status?: string;
  objectClass?: string;
  startDate?: string;
  endDate?: string;
  limit: number;
  offset: number;
}
export async function getQueryHistoryList(filters: Filters) {
  const rows = (
    await getPostgresPool().query(
      `SELECT t.session_id,t.request_seq FROM ${table("assistant_turns")} t JOIN ${table("assistant_sessions")} s ON s.id=t.session_id
    WHERE t.admitted AND s.domain_id=$1 AND s.owner_id=$2 AND ($3::timestamptz IS NULL OR t.created_at >= $3) AND ($4::timestamptz IS NULL OR t.created_at <= $4)
    ORDER BY t.created_at DESC,t.id DESC LIMIT $5 OFFSET $6`,
      [
        filters.domainId,
        filters.userId,
        filters.startDate ?? null,
        filters.endDate ?? null,
        filters.limit + 1,
        filters.offset,
      ],
    )
  ).rows;
  const items = [];
  for (const row of rows.slice(0, filters.limit)) {
    const evidence = await readAssistantTurnEvidence(
      row.session_id,
      row.request_seq,
      filters,
    );
    const objectClasses = [
      ...new Set(evidence.queries.flatMap((q) => q.objectClasses ?? [])),
    ];
    if (filters.status && evidence.turnRun.status !== filters.status) continue;
    if (filters.objectClass && !objectClasses.includes(filters.objectClass))
      continue;
    items.push({
      id: evidence.turnId,
      sessionId: evidence.sessionId,
      requestSeq: evidence.requestSeq,
      turnKey: evidence.turnKey,
      question: evidence.question,
      answer: evidence.answer,
      status: evidence.turnRun.status,
      createdAt: evidence.turnRun.startedAt,
      objectClasses,
      datasetArtifactIds: evidence.artifacts
        .filter((a) => a.path.endsWith(".dataset.json"))
        .map((a) => a.id),
    });
  }
  return {
    items,
    scanned: Math.min(rows.length, filters.limit),
    nextOffset:
      rows.length > filters.limit ? filters.offset + filters.limit : null,
  };
}
export async function getQueryHistoryDetail(
  sessionId: string,
  turnId: string,
  userId: string,
  domainId: string,
) {
  const turn = await assistantStore.turn(turnId, { userId, domainId });
  if (turn.session_id !== sessionId)
    throw new Error("Turn does not belong to the conversation");
  return readAssistantTurnEvidence(sessionId, turn.request_seq, {
    userId,
    domainId,
  });
}
