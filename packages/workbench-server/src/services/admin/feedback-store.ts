import type {
  FeedbackFilters,
  FeedbackRecord,
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
import { tForLocale } from "../../i18n";
export interface ListFeedbackOptions {
  domainId?: string;
  userId?: string;
  sourceType?: FeedbackSourceType;
  rating?: FeedbackRating;
  threadId?: string;
  taskId?: string;
  targetIds?: string[];
  feedbackId?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  /** Every record of the filter, unpaged: the export reads the whole set rather than a page of it. */
  all?: boolean;
  /** The request's language for the record labels and the filter choices. */
  locale?: string;
}

/**
 * The turn the feedback belongs to: the target when it is a turn, or one built from the conversation and its turn
 * number. The admin page used to derive this itself; the owner now answers it.
 */
export function feedbackTurnKey(input: {
  targetId?: string | null;
  threadId?: string | null;
  requestSeq?: number | null;
}): string {
  if (input.targetId?.startsWith("turn.")) return input.targetId;
  if (input.threadId && Number.isInteger(input.requestSeq))
    return `turn.${input.threadId}.${input.requestSeq}`;
  return "";
}

const FEEDBACK_FROM = () =>
  `FROM ${table("assistant_feedback")} f JOIN ${table("assistant_sessions")} s ON s.id=f.session_id JOIN ${table("assistant_turns")} t ON t.id=f.run_id JOIN ${table("assistant_agents")} a ON a.id=s.agent_id`;
const FEEDBACK_WHERE =
  `WHERE s.domain_id=$1 AND ($2::text IS NULL OR s.owner_id=$2) AND ($3::text IS NULL OR f.rating=$3) AND ($4::uuid IS NULL OR f.session_id=$4) AND ($5::text IS NULL OR f.text ILIKE '%'||$5||'%') AND ($6::text IS NULL OR CASE WHEN a.kind='regular' THEN 'qa' ELSE 'analysis_task' END=$6) AND ($7::uuid[] IS NULL OR f.target_id=ANY($7)) AND ($8::uuid IS NULL OR f.run_id=$8) AND ($9::uuid IS NULL OR f.id=$9)`;

function filterParams(
  o: Pick<
    ListFeedbackOptions,
    "domainId" | "userId" | "rating" | "threadId" | "keyword" | "sourceType" | "targetIds" | "taskId" | "feedbackId"
  >,
): (string | number | string[] | null)[] {
  return [
    o.domainId ?? null,
    o.userId ?? null,
    o.rating ?? null,
    o.threadId ?? null,
    o.keyword ?? null,
    o.sourceType ?? null,
    o.targetIds ?? null,
    o.taskId ?? null,
    o.feedbackId ?? null,
  ];
}

/** Administration is a projection of assistant feedback, never a second write owner. */
export async function listFeedback(
  o: ListFeedbackOptions,
): Promise<FeedbackPage> {
  const limit = Math.min(500, Math.max(1, o.limit ?? 20)),
    offset = Math.max(0, o.offset ?? 0);
  const params = filterParams(o);
  let paging = "";
  if (!o.all) {
    params.push(limit, offset);
    paging = " LIMIT $10 OFFSET $11";
  }
  const result = await getPostgresPool().query(
    `SELECT f.*,s.owner_id,s.domain_id,a.kind,t.request_seq,count(*) OVER() AS total ${FEEDBACK_FROM()} ${FEEDBACK_WHERE} ORDER BY f.updated_at DESC,f.id DESC${paging}`,
    params,
  );
  const records: FeedbackRecord[] = [];
  for (const row of result.rows) {
    const s = await new RuntimeClient(row.domain_id).run(row.run_id),
      target = s.messages.find((m) => m.id === row.target_id);
    const sourceType =
      row.kind === "regular" ? ("qa" as const) : ("analysis_task" as const);
    const rating = row.rating as FeedbackRating;
    records.push({
      id: row.id,
      sourceType,
      sourceTypeLabel: tForLocale(o.locale, `api.feedback.sources.${sourceType}`),
      targetId: row.target_id,
      threadId: row.session_id,
      taskId: row.run_id,
      rating,
      ratingLabel: tForLocale(o.locale, `api.feedback.ratings.${rating}`),
      userId: row.owner_id,
      userInput: messageText(
        s.messages.find((m) => m.message.role === "user")?.message ?? {
          content: "",
        },
      ),
      assistantOutput: target ? messageText(target.message) : undefined,
      feedbackText: row.text,
      turnKey: feedbackTurnKey({
        targetId: row.target_id,
        threadId: row.session_id,
        requestSeq: row.request_seq,
      }),
      updatedAt: new Date(row.updated_at).getTime(),
    });
  }
  return {
    records,
    total: Number(result.rows[0]?.total ?? 0),
    limit,
    offset,
    filters: feedbackFilters(o.locale),
  };
}

/** Counts feedback rows grouped by one filter dimension while applying search and the other filter. */
export async function countFeedback(o: {
  domainId: string;
  by: "sourceType" | "rating";
  sourceType?: FeedbackSourceType;
  rating?: FeedbackRating;
  keyword?: string;
}): Promise<Record<string, number>> {
  const column =
    o.by === "sourceType"
      ? "CASE WHEN a.kind='regular' THEN 'qa' ELSE 'analysis_task' END"
      : "f.rating";
  const params = filterParams({
    domainId: o.domainId,
    keyword: o.keyword,
    sourceType: o.by === "sourceType" ? undefined : o.sourceType,
    rating: o.by === "rating" ? undefined : o.rating,
  });
  const result = await getPostgresPool().query<{ key: string; count: string }>(
    `SELECT ${column} AS key, count(*)::text AS count ${FEEDBACK_FROM()} ${FEEDBACK_WHERE} GROUP BY 1`,
    params,
  );
  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.count)]));
}

/** The names, values and display names of the two feedback filters. */
function feedbackFilters(locale: string | undefined): FeedbackFilters {
  return {
    sourceType: {
      label: tForLocale(locale, "api.feedback.filters.sourceType"),
      options: [
        { value: "qa", label: tForLocale(locale, "api.feedback.sources.qa") },
        { value: "analysis_task", label: tForLocale(locale, "api.feedback.sources.analysis_task") },
      ],
    },
    rating: {
      label: tForLocale(locale, "api.feedback.filters.rating"),
      options: [
        { value: "like", label: tForLocale(locale, "api.feedback.ratings.like") },
        { value: "dislike", label: tForLocale(locale, "api.feedback.ratings.dislike") },
      ],
    },
  };
}
