import { inject, type InjectionKey } from "vue";
import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import type { AgentHostClient } from "./host";

/**
 * Platform chat host provided to mounted panels so official `AgentChatPanel` projections reuse the platform's own
 * authenticated `AgentHostClient` (same agent authorization and session history) without exposing raw transport
 * credentials to panel scripts.
 */
export interface PanelChatHost {
  /** Returns the authenticated AgentHostClient sharing the platform's own agent sessions and history. */
  client(): AgentHostClient;
  /** Optional application entry default agent used when a projection declares `agent: "page-default"`. */
  defaultAgent?: DefaultAgent;
  /**
   * Claim the page's composer surface while an embedded `AgentChatPanel` is mounted so the host hides its bottom
   * `PageComposer` and never shows two places to ask on the same page. Returns a release function called on unmount.
   */
  claimComposer?: () => () => void;
}

export const panelChatHostKey: InjectionKey<PanelChatHost> = Symbol("panel-chat-host");

/** The platform chat host provided to a panel instance, or null outside a platform panel host. */
export function usePanelChatHost(): PanelChatHost | null {
  return inject(panelChatHostKey, null);
}
