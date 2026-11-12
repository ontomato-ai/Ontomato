import { inject, type InjectionKey, type Ref, type Slot } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { ShellTaskPort } from "./host";
import type {
  ArtifactRendererOverride,
  OpenArtifact,
  ShellLabels,
  ToolRendererOverride,
} from "./types";

export interface ShellContext {
  labels: Ref<ShellLabels>;
  /** The host's task routes, when its conversations delegate work. */
  tasks?: ShellTaskPort;
  /** The task the reader asked to see (from the task list); its card or review opens and scrolls into view. */
  taskFocus?: Ref<{ taskId: string; at: number } | null>;
  /** Opens the task list at one reply's delegated work. */
  openTasks?: (runId: string) => void;
  artifactRenderers: Ref<readonly ArtifactRendererOverride[]>;
  toolRenderers: Ref<readonly ToolRendererOverride[]>;
  /** Host slots for business actions: `artifact-actions` ({artifact, title}), `dataset-selection-actions` ({artifact, title, selectedRowIndices}) and `message-actions`. */
  slots: { artifactActions?: Slot; messageActions?: Slot; datasetSelectionActions?: Slot };
  resolveArtifact(runId: string, path: string): Promise<RuntimeArtifact | null>;
  /** Changes whenever a run registers new artifacts, so unresolved references retry. */
  artifactRevision: Ref<number>;
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
  openArtifact(open: OpenArtifact): void;
  openArtifactKey: Ref<string | null>;
  /** Opens an in-app page link beside the conversation, or null when the host does not recognise the address. */
  pageLink(href: string): (() => void) | null;
  /** Continue the current conversation from an explicit artifact action. */
  continueConversation?: (message: string) => Promise<void>;
}

/** The message whose Markdown is rendering; artifact references resolve within its run. */
export interface MessageContext {
  runId: string;
}

export const shellContextKey: InjectionKey<ShellContext> = Symbol("agent-shell");
export const messageContextKey: InjectionKey<Ref<MessageContext>> = Symbol("agent-shell-message");

/**
 * How much of a full page's foot the shell's floating composer covers, in pixels; 0 beside the conversation. The pane
 * also sets it on itself as `--pane-dock-space`, for the page's styles.
 */
export const pageDockSpaceKey: InjectionKey<Readonly<Ref<number>>> = Symbol("page-dock-space");

/**
 * The room a page in the shell's page pane keeps after its own scrolling content, for a page that scrolls itself
 * (`ShellFeatureDeclaration.scrollsItself`) and hands it on, e.g. to the app in a frame. The pages themselves mark
 * where the content ends with the `shell-dock-room` class or the `ShellDockRoom` component, which read the same value.
 */
export function usePageDockSpace() {
  return inject(pageDockSpaceKey)!;
}

/** Artifact overrides can use the conversation capability even through a renderer wrapper. */
export function useConversationContinuation() {
  return inject(shellContextKey, undefined)?.continueConversation;
}
