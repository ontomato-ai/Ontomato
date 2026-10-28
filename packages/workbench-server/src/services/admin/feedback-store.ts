import type {
  FeedbackSourceType,
  FeedbackRating,
  FeedbackPage,
} from "@ontomato/contracts/feedback";
import {
  getPostgresPool,
  qualifiedTable as table,
} from "../../infrastructure/postgres";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { messageText } from "../../platform/agent-runtime/runtime";
export interface ListFeedbackOptions {
  domainId?: string;
  userId?: string;
  sourceType?: FeedbackSourceType;
  rating?: FeedbackRating;
  threadId?: string;
  taskId?: string;
  targetIds?: string[];
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** Administration is a projection of assistant feedback, never a second write owner. */
export async function listFeedback(
  o: ListFeedbackOptions,
): Promise<FeedbackPage> {
  const limit = Math.min(500, Math.max(1, o.limit ?? 20)),
    offset = Math.max(0, o.offset ?? 0);
  const result = await getPostgresPool().query(
    `SELECT f.*,s.owner_id,s.domain_id,a.kind,count(*) OVER() AS total FROM ${table("assistant_feedback")} f JOIN ${table("assistant_sessions")} s ON s.id=f.session_id JOIN ${table("assistant_turns")} t ON t.id=f.run_id JOIN ${table("assistant_agents")} a ON a.id=s.agent_id WHERE s.domain_id=$1 AND ($2::text IS NULL OR s.owner_id=$2) AND ($3::text IS NULL OR f.rating=$3) AND ($4::uuid IS NULL OR f.session_id=$4) AND ($5::text IS NULL OR f.text ILIKE '%'||$5||'%') AND ($6::text IS NULL OR CASE WHEN a.kind='regular' THEN 'qa' ELSE 'analysis_task' END=$6) AND ($7::uuid[] IS NULL OR f.target_id=ANY($7)) AND ($8::uuid IS NULL OR f.run_id=$8) ORDER BY f.updated_at DESC,f.id DESC LIMIT $9 OFFSET $10`,
    [
      o.domainId,
      o.userId ?? null,
      o.rating ?? null,
      o.threadId ?? null,
      o.keyword ?? null,
      o.sourceType ?? null,
      o.targetIds ?? null,
      o.taskId ?? null,
      limit,
      offset,
    ],
  );
  const records = [];
  for (const row of result.rows) {
    const s = await new RuntimeClient(row.domain_id).run(row.run_id),
      target = s.messages.find((m) => m.id === row.target_id);
    records.push({
      id: row.id,
      sourceType:
        row.kind === "regular" ? ("qa" as const) : ("analysis_task" as const),
      targetId: row.target_id,
      threadId: row.session_id,
      taskId: row.run_id,
      rating: row.rating,
      userId: row.owner_id,
      userInput: messageText(
        s.messages.find((m) => m.message.role === "user")?.message ?? {
          content: "",
        },
      ),
      assistantOutput: target ? messageText(target.message) : undefined,
      feedbackText: row.text,
      createdAt: new Date(row.updated_at).getTime(),
    });
  }
  return { records, total: Number(result.rows[0]?.total ?? 0), limit, offset };
}
