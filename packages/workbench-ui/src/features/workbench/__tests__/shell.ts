import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { AgentShell, displayLink, type ConversationDisplay } from "@ontomato/agent-shell-ui";
import en from "../../../locales/en";

/*
 * The agent platform's real shell around a page under test, behind the host doubles of `host-double.ts`: what a test
 * drives is what sits beside the conversation — the shell's own controls and the address.
 */

/** What the shell shows beside the conversation. */
export const displayOf = (wrapper: VueWrapper) => wrapper.findComponent(AgentShell).props("display") as ConversationDisplay;

/** How the shell opens an in-app link in an answer; null when it leaves the link as text. */
export const linkOf = (wrapper: VueWrapper, href: string) =>
  displayLink(displayOf(wrapper), wrapper.findComponent(AgentShell).props("pageLinks") as ((href: string) => (() => void) | null) | undefined)(href);

/** Follows an in-app link in an answer, as the reader clicking it in the shell. */
export async function openLink(wrapper: VueWrapper, href: string) {
  linkOf(wrapper, href)!();
  await flushPromises();
}

/** One of the page pane's own controls. */
export function paneButton(wrapper: VueWrapper, control: "close" | "expand" | "collapse") {
  return wrapper.find<HTMLButtonElement>(`.page-pane .pane-header button[aria-label="${en.assistant[control]}"]`);
}
