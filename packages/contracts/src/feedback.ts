export type FeedbackSourceType = "qa" | "analysis_task";

export type FeedbackRating = "like" | "dislike";

/** One value of a feedback filter and its display name in the request's language. */
export interface FeedbackFilterOption {
  value: string;
  label: string;
}

export interface FeedbackFilters {
  sourceType: FeedbackFilterOption[];
  rating: FeedbackFilterOption[];
}

export interface FeedbackRecord {
  id: string;
  sourceType: FeedbackSourceType;
  /** The source's display name in the request's language. */
  sourceTypeLabel: string;
  targetId: string;
  threadId?: string;
  requestSeq?: number;
  taskId?: string;
  rating: FeedbackRating;
  /** The rating's display name in the request's language. */
  ratingLabel: string;
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
  filters: FeedbackFilters;
}
