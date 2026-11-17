import { inject, type InjectionKey, type Ref } from "vue";
import type { PageDraftLink } from "@ontomato/agent-shell-ui";

/**
 * Where an agent's settings page is and how it moves. At its own address that is the address itself; beside a
 * conversation the page's address is a parameter of the agent platform's, so the page reads its draft link, its moves
 * and the address to show once a draft is saved from the page that mounts it — never from the browser's address, which
 * is the conversation's.
 *
 * One component either way: the page that mounts the settings provides this, and the editor asks for it.
 */
export interface AgentSettingsAddress {
  /** The page's own address, with its query (a draft handoff included). */
  address: Readonly<Ref<string>>;
  /** The draft the address names, if any. */
  draft: Readonly<Ref<PageDraftLink | null>>;
  /** The address to show once the draft has been saved: the same page without its draft handoff. */
  savedAddress: Readonly<Ref<string>>;
  /** Moves the page: the host turns this into its own navigation. */
  go(address: string): void;
}

export const agentSettingsAddressKey: InjectionKey<AgentSettingsAddress> = Symbol("agent-settings-address");

/** The address the settings page is shown at; a page mounted without one falls back to the browser's address. */
export function useAgentSettingsAddress(): AgentSettingsAddress | null {
  return inject(agentSettingsAddressKey, null);
}
