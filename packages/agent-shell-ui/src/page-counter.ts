import { inject, type InjectionKey, type Ref } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";

/**
 * The page's way back to the one counter (DESIGN.md "Applications and shells"): a page at its own address puts the same
 * composer at its foot as the conversation does, and a message written there goes to the agent platform with the page it
 * was written on. The platform's assembly provides this; a page only asks for it, so no page owns a second input box or
 * imports the counter's own code.
 */
export interface PageCounter {
  /** The agents the account may talk to in the counter; read when a page shows its composer. */
  agents(): Promise<readonly AgentHostAgent[]>;
  /** The agent the counter last used, when the reader may still use it. */
  preferredAgentId: Readonly<Ref<string | null>>;
  /**
   * Sends the page's message to the counter with the page's address: the conversation this tab holds with that agent
   * goes on, and the same page opens beside it.
   */
  ask(agentId: string, text: string, page: string): void;
}

export const pageCounterKey: InjectionKey<PageCounter> = Symbol("page-counter");

/** The counter a page at its own address sends to, or null where the assembly provides none. */
export function usePageCounter(): PageCounter | null {
  return inject(pageCounterKey, null);
}
