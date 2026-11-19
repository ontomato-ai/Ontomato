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
