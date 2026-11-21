export type FeedbackSourceType = "qa" | "analysis_task";

export type FeedbackRating = "like" | "dislike";

/** One value of a feedback filter and its display name in the request's language. */
export interface FeedbackFilterOption {
  value: string;
  label: string;
}

/** One filter of the feedback page: its own name and the values it offers. */
export interface FeedbackFilter {
  label: string;
  options: FeedbackFilterOption[];
}

export interface FeedbackFilters {
  sourceType: FeedbackFilter;
  rating: FeedbackFilter;
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
  /**
   * When this reader last gave or changed the rating (`assistant_feedback.updated_at`): the feedback row keeps no
   * separate creation time, so the list orders by the newest change and says so.
   */
  updatedAt: number;
}

export interface FeedbackPage {
  records: FeedbackRecord[];
  total: number;
  limit: number;
  offset: number;
  filters: FeedbackFilters;
}
