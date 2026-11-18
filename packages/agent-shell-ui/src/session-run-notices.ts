import type { InjectionKey, DeepReadonly, Ref } from "vue";
import type { AgentHostSessionRunFrame } from "@ontomato/contracts/agent-host";
import type { PresentationBinding, PresentationFrame, PresentationReceipt } from "@ontomato/contracts/agent-presentation";

/** The page's single feed also informs the selected conversation, without another connection. */
export const sessionRunNotices: InjectionKey<DeepReadonly<Ref<AgentHostSessionRunFrame | null>>> = Symbol("session-run-notices");

/**
 * The page's live display binding, from its one feed: the binding of the connection now open (null while none is), and
 * the shell that answers the presentation requests riding on it. One shell attaches at a time.
 */
export interface PagePresentation {
  binding: Readonly<Ref<PresentationBinding | null>>;
  attach(present: (frame: PresentationFrame) => Promise<PresentationReceipt["result"]>): () => void;
}
export const pagePresentation: InjectionKey<PagePresentation> = Symbol("page-presentation");
