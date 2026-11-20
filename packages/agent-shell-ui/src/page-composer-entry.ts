import type { InjectionKey } from "vue";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";

/**
 * A panel's conversation entry reaching the composer on screen (design U18). The host checks the request against the
 * panel's own declaration before it gets here; the composer then only opens, picks the target among this page's current
 * candidates and fills the text. It never sends.
 */
export type PageComposerExpand = (request: PanelConversationEntry) => void;

/**
 * Where the composer on screen (a page's foot composer, or the one beside the conversation) registers its entry while it
 * is shown. The latest registration serves; the returned function withdraws it, and the one before serves again. A host
 * without panel frames provides nothing, and its composers register nowhere.
 */
export type ServePageComposer = (expand: PageComposerExpand) => () => void;

export const servePageComposerKey: InjectionKey<ServePageComposer> = Symbol("serve-page-composer");

/**
 * The agent an entry's target names among the page's current candidates, or null when it names none of them: then the
 * composer only opens and keeps its agent. `page-default` is the page's registered default; `id` must be offered; a
 * `preset` is resolved by the page's default-agent selector on the server, which the candidates do not carry yet, so it
 * names none here.
 */
export function entryAgent(
  target: PanelConversationEntry["target"],
  candidates: readonly { id: string; enabled: boolean }[],
  pageDefault: string | null | undefined,
): string | null {
  const offered = (id: string | null | undefined) => candidates.some((agent) => agent.enabled && agent.id === id);
  if (target.kind === "page-default") return offered(pageDefault) ? pageDefault! : null;
  if (target.kind === "id") return offered(target.id) ? target.id : null;
  return null;
}

/** What a composer is asked to show by an entry: opened, with this text when the entry fills one. */
export type ComposerEntry = { text: string | null; seq: number };
