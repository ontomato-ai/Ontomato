import { inject, onBeforeUnmount, onMounted, reactive, type InjectionKey, type Ref, type Slot } from "vue";
import type { AgentPendingQuestion } from "@ontomato/contracts/agent-channel";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { ShellTaskPort } from "./host";
import type { useAgentConversation } from "./useAgentConversation";
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
  /** Host slots for business actions: `artifact-actions` ({artifact, title, caption?}), `dataset-selection-actions` ({artifact, title, selectedRowIndices}) and `message-actions`. */
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
  /** The questions the conversation's agents asked the reader, answered from the panel over each of its composers. */
  questions: ShellQuestions;
}

export interface ShellQuestions {
  /** Every question asked of the reader that has no answer yet, as the conversation's host reports it. */
  pending: Readonly<Ref<AgentPendingQuestion[]>>;
  /** A message of the conversation is on its way; an answer waits until it has arrived. */
  sending: Readonly<Ref<boolean>>;
  /**
   * Sends the reader's answer to one question; resolves to whether it was delivered. `selectedOption` is the zero-based
   * index of the option the reader picked, and absent for the reader's own words: only the pick itself says which option
   * was chosen, never the text, the default or another party's answer.
   */
  answer(requestId: string, answer: string, selectedOption?: number): Promise<boolean>;
  view: QuestionView;
}

/** The reader's unsent answer to one question: the option picked (its index, or the reader's own answer) and that text. */
export interface QuestionDraft {
  choice: number | "other" | null;
  other: string;
}

/**
 * What the reader does with the questions on this page, shared by the panels over the conversation's composers (the
 * conversation's own and a full page's): whether the panel is open and on which question, the unsent drafts, and the
 * questions skipped here. None of it is sent or kept, so a reload lists every unanswered question again.
 */
export interface QuestionView {
  open: boolean;
  current: string | null;
  drafts: Record<string, QuestionDraft>;
  skipped: string[];
}

/** A conversation's questions for the shell context, with a view of its own for the page that holds the conversation. */
export function conversationQuestions(
  conversation: Pick<ReturnType<typeof useAgentConversation>, "pendingQuestions" | "sending" | "answerQuestion">,
): ShellQuestions {
  return {
    pending: conversation.pendingQuestions,
    sending: conversation.sending,
    answer: async (requestId, answer, selectedOption) =>
      Boolean((await conversation.answerQuestion(requestId, answer, selectedOption))?.delivery),
    view: reactive<QuestionView>({ open: true, current: null, drafts: {}, skipped: [] }),
  };
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

/**
 * Where the side's outlet reports its own form (beside the conversation, or over it on a narrow screen): the outlet's
 * style decides it, and the display reads it from there instead of repeating the breakpoint.
 */
export const displayPlacementKey: InjectionKey<(probe: () => "side" | "overlay") => () => void> = Symbol("display-placement");

/** Reports the outlet's own form while `element` is mounted: fixed over the conversation is the overlay. */
export function useDisplayPlacement(element: Ref<HTMLElement | null>) {
  const place = inject(displayPlacementKey);
  let release: (() => void) | undefined;
  onMounted(() => {
    release = place?.(() => (getComputedStyle(element.value!).position === "fixed" ? "overlay" : "side"));
  });
  onBeforeUnmount(() => release?.());
}
