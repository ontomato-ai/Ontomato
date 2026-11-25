import type { PanelDataState } from "@ontomato/contracts/panel-host";

/** The last successful datum answer for the same target, kept beside a failed or retrying read. */
export type MemberReadyData = Extract<PanelDataState, { status: "ready" }>;

/**
 * One named datum of a member as a component shows it: the host's answer, still loading, or awaiting a selection. A
 * failure carries `retry`, which reads it again; one the platform never answered (the page reached nothing) is
 * `unreachable`, and is worded in the reader's language where it is shown, not with the browser's own words. When
 * re-reading the same target fails (or retries from a failure), `previous` carries the last successful answer for that
 * target; switching targets, losing access (`forbidden`), or receiving `empty` clears `previous`.
 */
export type MemberDataState =
  | (MemberReadyData & { readonly refreshing?: true })
  | Exclude<PanelDataState, { status: "error" | "ready" | "loading" }>
  | { status: "loading"; readonly previous?: MemberReadyData }
  | {
      status: "error";
      message: string;
      code?: string;
      unreachable?: true;
      retry?: () => void;
      readonly previous?: MemberReadyData;
    }
  | { status: "awaiting" };

/** Shows a failed datum beside its last answer and the read that can retry it. */
export function withMemberReadRetry(result: MemberDataState, previous: MemberReadyData | undefined, retry: () => void): MemberDataState {
  return result.status === "error" ? { ...result, ...(previous && { previous }), retry } : result;
}
