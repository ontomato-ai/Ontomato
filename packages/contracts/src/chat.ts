import type { SseErrorEvent } from "./errors";
import type { QueryThinkingState, ThinkingProgress, ThinkingStep, QcState } from "./query-thinking";
import type { QueryExecutionDisplayFact } from "./query-execution";
export interface ClarificationOption {
  id: string;
  resolvedQuestion: string;
}

/** Wire shape of the standard query projection sent directly over the HTTP stream. */
export type ChatClientEvent =
  | SseErrorEvent
  | RunCancelledEvent
  | RunNotFoundEvent
  | TurnFinishedEvent
  | {
      type: "run_started";
      runId: string;
      threadId: string;
      turnKey?: string;
      requestSeq?: number;
      timestamp: number;
    }
  | { type: "turn_key"; turnKey: string; threadId: string; requestSeq: number; timestamp: number }
  | { type: "title"; title: string }
  | {
      type: "workflow_complete";
      plan?: unknown;
      hasQuery: boolean;
      hasAnalysis: boolean;
      hasVisualization: boolean;
    }
  | { type: "auth_failed"; error: string }
  | { type: "token" | "analysis_token"; content: string }
  | { type: "thinking_state"; thinking: string; thinkingState?: QueryThinkingState }
  | {
      type: "thinking_summary";
      thinkingSummary: string;
      thinkingSteps?: ThinkingStep[];
      thinkingState?: QueryThinkingState;
    }
  | { type: "abc_progress"; progress: ThinkingProgress }
  | AbcContentEvent
  | {
      type: "result";
      content:
        | string
        | { markdownTable?: string; content?: string; execution?: QueryExecutionDisplayFact };
    }
  | { type: "query_datasets"; datasets: unknown[]; nodeIds: string[] }
  | { type: "post_thinking"; content: string; label?: string; mode?: string; qcState?: QcState }
  | { type: "clarification"; message: string; options: ClarificationOption[] }
  | { type: "chain_start"; name: string; icon: string; description?: string }
  | { type: "visualization_html"; html: string; chartType?: string; title?: string };

export interface RunCancelledEvent {
  type: "run_cancelled";
  timestamp: number;
  turnKey?: string;
  threadId?: string;
  requestSeq?: number;
}

/**
 * Server-recorded end of one turn, sent before the stream's terminal frame.
 * `durationMs` ends when the answer is ready, before waiting for quality checks; history reads use the same fact.
 */
export interface TurnFinishedEvent {
  type: "turn_finished";
  durationMs: number;
}

/** Answer to a run cancel request; `durationMs` is the cancelled turn's recorded span when its turn run was open. */
export interface RunCancelResponse {
  success: true;
  cancelled: boolean;
  turnKey?: string;
  requestSeq?: number;
  durationMs?: number;
}

export interface RunNotFoundEvent {
  type: "run_not_found";
  timestamp: number;
}

/**
 * Live answer body of the query: `append` carries only the text added after what was already sent;
 * `replace` carries the whole current body (first frame, or when earlier text changed).
 */
export type AbcContentEvent =
  | { type: "abc_content"; mode: "append"; delta: string; loading: boolean }
  | { type: "abc_content"; mode: "replace"; content: string; loading: boolean };

/** The body after applying one `abc_content` frame to the body built from the frames before it. */
export function applyAbcContent(body: string, event: AbcContentEvent): string {
  return event.mode === "append" ? body + event.delta : event.content;
}

export type ThreadMessagesPayload = {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    requestSeq?: number;
    snapshot?: unknown;
    /** Assistant turns only: time to the answer; old records retain their recorded terminal duration. */
    durationMs?: number;
  }>;
  activeTurn?: {
    requestSeq: number;
  };
};

export interface ThreadListItem {
  threadId: string;
  title: string;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
  lastCheckpointId: string | null;
}
export interface ThreadListResponse {
  threads: ThreadListItem[];
  total: number;
}
