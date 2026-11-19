export type FeedbackSourceType = "qa" | "analysis_task";

export type FeedbackRating = "like" | "dislike";

export interface FeedbackRecord {
  id: string;
  sourceType: FeedbackSourceType;
  targetId: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  rating: FeedbackRating;
  userId: string;
  userName?: string;
  userInput?: string;
  assistantOutput?: string;
  feedbackText?: string;
  metadata?: unknown;
  /** The turn the feedback belongs to, derived by the owner; empty when it names a turn this record does not reach. */
  turnKey: string;
  createdAt: number;
}

export interface FeedbackPage {
  records: FeedbackRecord[];
  total: number;
  limit: number;
  offset: number;
}
