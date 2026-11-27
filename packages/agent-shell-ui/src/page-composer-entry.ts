import type { InjectionKey } from "vue";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";

/**
 * A panel's conversation entry reaching the composer on screen (design U18). The host checks the request against the
 * panel's own declaration before it gets here; the composer then only opens, picks the target among this page's current
 * candidates and applies the declared click behavior.
 */
export type PageComposerRequest = PanelConversationEntry & {
  slot?: string;
  /**
   * Set by the host when the entry is a preview's: the conversation it opens is the preview's, so every run in it runs as
   * the preview. It never continues a conversation the reader already has.
   */
  preview?: true;
};
export type PageComposerExpand = (request: PageComposerRequest) => void | Promise<void>;

/**
 * Where the composer on screen (a page's foot composer, or the one beside the conversation) registers its entry while it
 * is shown. The latest registration serves; the returned function withdraws it, and the one before serves again. A host
 * without panel frames provides nothing, and its composers register nowhere.
 */
export type ServePageComposer = (expand: PageComposerExpand) => () => void;

export const servePageComposerKey: InjectionKey<ServePageComposer> = Symbol("serve-page-composer");

/**
 * The outcome of resolving a conversation entry's target agent against the current candidates: either the enabled
 * candidate ID to use, or an explicit unavailable result so callers never silently fall back to the current agent.
 */
export type EntryAgentResolution =
  | { readonly ok: true; readonly agentId: string }
  | { readonly ok: false; readonly reason: "unavailable"; readonly target: PanelConversationEntry["target"] };

/**
 * Resolves the agent an entry's target names among the page's current candidates. `page-default` is the page's
 * registered default; `id` must be offered; a `preset` is the candidate the server's answer says is that preset in this
 * domain. When the target is absent or disabled, returns an explicit unavailable result instead of guessing or falling
 * back to another agent.
 */
export function entryAgent(
  target: PanelConversationEntry["target"],
  candidates: readonly { id: string; enabled: boolean }[],
  pageDefault: string | null | undefined,
  presetAgentIds: Readonly<Record<string, string>> | undefined,
): EntryAgentResolution {
  const offered = (id: string | null | undefined) => candidates.some((agent) => agent.enabled && agent.id === id);
  const candidate =
    target.kind === "page-default"
      ? pageDefault
      : target.kind === "id"
        ? target.id
        : presetAgentIds?.[target.agentKind];
  return offered(candidate)
    ? { ok: true, agentId: candidate! }
    : { ok: false, reason: "unavailable", target };
}

/** What a composer is asked to show by an entry: opened, with this text when the entry fills one. */
export type ComposerEntry = { text: string | null; seq: number };
