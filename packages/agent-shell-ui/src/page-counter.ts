import { inject, type InjectionKey, type Ref } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import type { PageAgents } from "./host";

/**
 * The page's way back to the one counter (DESIGN.md "Applications and shells"): a page at its own address puts the same
 * composer at its foot as the conversation does, and a message written there goes to the agent platform with the page it
 * was written on. The platform's assembly provides this; a page only asks for it, so no page owns a second input box or
 * imports the counter's own code.
 */
export interface PageCounter {
  /** The agents the account may talk to in the counter; read when a page shows its composer. */
  agents(): Promise<readonly AgentHostAgent[]>;
  /**
   * The page's own candidates: with the page's skill declaration, the agents that carry it and the page's registered
   * default, read from the same directory the conversation's composer reads beside the page. A page without a
   * declaration has no candidates of its own and offers `agents()`.
   *
   * A refusal (the reader holds no mapping for the page, or the page's registered default is gone) is the page's
   * configuration error and is not replaced by another agent.
   */
  pageAgents(page: PageSkillContext): Promise<Omit<PageAgents, "agents"> & { agents: readonly AgentHostAgent[] }>;
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
