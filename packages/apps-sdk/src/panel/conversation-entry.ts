import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";

/**
 * What a declared conversation entry opens the page's composer with: its agent, and its opening sentence — written out,
 * or its key read in the panel's own words, which answer the key itself where neither the reader's language nor the
 * default has words for it: the composer then opens with no sentence, never with the key.
 */
export function composerEntry(entry: PanelConversationEntry, text: (key: string) => string): PanelConversationEntry {
  const keyed = entry.prefillKey !== undefined ? text(entry.prefillKey) : undefined;
  const prefill = entry.prefillKey !== undefined ? (keyed === entry.prefillKey ? undefined : keyed) : entry.prefill;
  return { target: entry.target, ...(prefill !== undefined ? { prefill } : {}) };
}
