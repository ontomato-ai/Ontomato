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
  /** One agent's page with this address's query, its draft handoff included: where a saved create draft opens. */
  agentAddress(id: string): string;
  /** Moves the page: the host turns this into its own navigation. */
  go(address: string): void;
}

export const agentSettingsAddressKey: InjectionKey<AgentSettingsAddress> = Symbol("agent-settings-address");

/**
 * The address the settings page is shown at. Its editor is mounted only by `AgentSettingsRoute`, which provides this, so
 * a missing one is a mounting mistake rather than a case to fall back from.
 */
export function useAgentSettingsAddress(): AgentSettingsAddress {
  const address = inject(agentSettingsAddressKey, null);
  if (!address) throw new Error("The agents' settings are read inside the page that mounts them, which provides their address");
  return address;
}
