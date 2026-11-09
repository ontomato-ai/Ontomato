import type { Component } from "vue";
import { Eye, Files, GitCompare, History } from "lucide-vue-next";

/** The builder's one page beside the conversation: the open workspace, in four views. */
export const PANEL_ID = "workspace";

export type PanelTab = "preview" | "files" | "changes" | "history";

export const PANEL_TABS: readonly { id: PanelTab; label: string; icon: Component }[] = [
  { id: "preview", label: "appBuilder.tabPreview", icon: Eye },
  { id: "files", label: "appBuilder.tabFiles", icon: Files },
  { id: "changes", label: "appBuilder.tabChanges", icon: GitCompare },
  { id: "history", label: "appBuilder.tabHistory", icon: History },
];

/**
 * What the changes view shows: `latest` is the newest commit against its parent (it follows new commits), `working`
 * the current files against HEAD, anything else that one commit against its parent.
 */
export type ChangeTarget = string;

export const shortCommit = (id: string) => id.slice(0, 7);
/** A conversation is titled by its first message, whose later lines carry the page context. */
export const firstLine = (text: string) => text.split("\n", 1)[0]!;
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
