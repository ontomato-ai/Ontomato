import type { InjectionKey, DeepReadonly, Ref } from "vue";
import type { AgentHostObjectChangedFrame, AgentHostSessionRunFrame } from "@ontomato/contracts/agent-host";
import type { PresentationBinding, PresentationFrame, PresentationReceipt } from "@ontomato/contracts/agent-presentation";

/** The page's single feed also informs the selected conversation, without another connection. */
export const sessionRunNotices: InjectionKey<DeepReadonly<Ref<AgentHostSessionRunFrame | null>>> = Symbol("session-run-notices");

/** The shell that shows the page's conversation, as the page's feed hands it the view's live frames. */
export interface SessionStreamShell {
  /** A request to show something beside the conversation, answered once. */
  present(frame: PresentationFrame): Promise<PresentationReceipt["result"]>;
  /** An agent changed an object in the conversation rooted at `frame.session`. */
  objectChanged(frame: AgentHostObjectChangedFrame): void;
  /** A connection is ready: what changed while there was none was delivered to nobody. */
  ready(): void;
}

/**
 * The page view's session stream, from the page's one feed (design "long connections" 5): the view's binding, stable for
 * as long as the view is mounted — the runs its shell starts carry it, and whichever connection is current serves it —
 * and the shell that takes the live frames riding on that connection. One shell attaches at a time.
 */
export interface PageSessionStream {
  binding: PresentationBinding;
  attach(shell: SessionStreamShell): () => void;
}
export const pageSessionStream: InjectionKey<PageSessionStream> = Symbol("page-session-stream");
