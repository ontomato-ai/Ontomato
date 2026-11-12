import type { Component } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunStatus } from "@ontomato/contracts/agent-runtime-values";

export type ArtifactPresentation = "inline" | "panel";

/** Props of every artifact renderer; the same renderer serves inline and panel views. */
export interface ArtifactRendererProps {
  artifact: RuntimeArtifact;
  title: string;
  presentation: ArtifactPresentation;
  read: () => Promise<Blob>;
  openDetails?: () => void;
  continueConversation?: (message: string) => Promise<void>;
  /** The renderer this one replaces (shell default or file card), so an override can wrap it. */
  fallback?: Component | null;
}

/**
 * A host override for artifact rendering. A path pattern wins over extensions; among extensions the
 * longest match wins. Unmatched files use the shell default for their extension, then a file card.
 */
export interface ArtifactRendererOverride {
  extensions?: string[];
  path?: RegExp;
  component: Component;
}

/** One thinking or tool step as the process view shows it. */
export interface ProcessStepView {
  key: string;
  kind: "thinking" | "tool";
  /** Thinking text, or the tool's main argument. */
  text: string;
  toolName: string;
  /** Skill whose script a bash command runs (skills/<name>/...), if any. */
  skill: string | null;
  args: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "unknown" | "streaming" | "done";
  output: string;
}

/** Props of a tool step renderer. `fallback` is the shell's default step view. */
export interface ToolStepProps {
  step: ProcessStepView;
  fallback?: Component | null;
}

/** A host override for tool steps, matched by skill name first, then by tool name. */
export interface ToolRendererOverride {
  tools?: string[];
  skills?: string[];
  component: Component;
}

/** Feature entry in the navigation; editions declare their own. */
export interface ShellFeatureDeclaration {
  id: string;
  label: string;
  /** Icon name from the shell's curated set. */
  icon: string;
  /** page: host content in the main area; action: the host reacts in place; link: navigate away. */
  availability: "page" | "action" | "link" | "unavailable";
  href?: string;
  hint?: string;
  /**
   * The page can sit beside the conversation (DESIGN "Agent apps"): opened full with a composer below it, it can be
   * collapsed into the side panel and expanded again, and messages sent while it is open carry the host's page context.
   */
  withConversation?: boolean;
  /**
   * The page fills the pane's height and scrolls inside itself (an app frame, an editor). Full, the composer floats over
   * its foot and the pane leaves the page its whole height: the page marks where its content ends, with the shell's
   * `shell-dock-room` class on a vertical scroll area or the `ShellDockRoom` component where a class cannot reach, and
   * the shell keeps the covered room there (`--pane-dock-space`, `usePageDockSpace()`). Other pages scroll in the pane,
   * which keeps that room for them.
   */
  scrollsItself?: boolean;
}

/** A workbench is a code declaration; its agents come from the host. */
export interface ShellWorkbenchDeclaration {
  id: string;
  label: string;
  features: ShellFeatureDeclaration[];
}

export interface ShellFeedbackTarget {
  sessionId: string;
  runId: string;
  messageId: string;
}

export interface ShellFeedbackValue {
  rating: "like" | "dislike";
  /** Required for dislike. */
  reason: string;
}

/** Feedback storage belongs to the host; the shell only shows and submits the rating. */
export interface ShellFeedbackPort {
  read(target: ShellFeedbackTarget): Promise<ShellFeedbackValue | null>;
  submit(target: ShellFeedbackTarget, value: ShellFeedbackValue): Promise<ShellFeedbackValue>;
  remove(target: ShellFeedbackTarget): Promise<void>;
}

/**
 * A run of the open conversation started or stopped, whether the stream, a cancel or a re-read showed it: the host
 * refreshes what the run changes from here rather than from the reply's words.
 */
export interface ShellRunChange {
  sessionId: string;
  runId: string;
  status: RuntimeRunStatus;
  /** The workspace commit a stopped run saved; null while it runs and for a run that changed no file. */
  workspaceCommit: string | null;
}

/** Context passed to the host's message action slot. */
export interface MessageActionContext {
  workspaceCommit: string | null;
  sessionId: string;
  runId: string;
  messageId: string;
  text: string;
}

/** Fixed shell text supplied by the host's i18n. */
export interface ShellLabels {
  selectRow?: (row: number) => string;
  selectedRows?: (count: number) => string;
  analyzeSelection?: string;
  compareSelection?: string;
  clearSelection?: string;
  /** The ordinary user message that continues from selected records; `rows` are 1-based positions in the source file. */
  analyzeSelectionMessage?: (file: { title: string; path: string }, rows: number[]) => string;
  compareSelectionMessage?: (file: { title: string; path: string }, rows: number[]) => string;
  newConversation: string;
  agent: string;
  sessions: string;
  noSessions: string;
  more: string;
  loadFailed: string;
  retry: string;
  deleteSession: string;
  renameSession?: string;
  sessionActions?: string;
  deleteConfirm: string;
  unavailable: string;
  /** Marks a session that one of the user's scheduled tasks started. */
  scheduledSession: string;
  placeholder: string;
  send: string;
  stop: string;
  greeting: string;
  steps: (count: number) => string;
  thinking: string;
  working: string;
  toolInput: string;
  toolOutput: string;
  stopped: string;
  truncated: string;
  failed: string;
  copy: string;
  copied: string;
  like: string;
  dislike: string;
  feedbackReason: string;
  submit: string;
  cancel: string;
  open: string;
  download: string;
  close: string;
  preparing: string;
  artifactMissing: string;
  menu: string;
  /** Accessible name of the mark on links that open in a new tab; without it the mark is decorative. */
  opensInNewTab?: string;
  scrollToBottom: string;
  /** Page controls: show the page full width, or beside the conversation. */
  expand: string;
  collapse: string;
  loading: string;
  emptyFile: string;
  invalidChart: string;
  toolRead: string;
  toolWrite: string;
  toolEdit: string;
  toolBash: string;
  toolSkill: string;
  /** Business actions of analyst and retrieval commands, used for step names and run summaries. */
  activitySchema: string;
  activityValues: string;
  activityQuery: string;
  activityKnowledge: string;
  activityDataset: string;
  activityCompute: string;
  /** Heading of how a dataset was obtained, under its table: each query with its conditions, and the graph. */
  datasetLineage: string;
  showLineage: string;
  hideLineage: string;
  /** The graph's columns: the objects the data comes from, the fields used, the calculations and the result columns. */
  lineageSources: string;
  lineageFields: string;
  lineageOperations: string;
  lineageOutputs: string;
  /** A dataset holds only the first `limit` rows of its result. */
  truncatedRows: (limit: number) => string;
  /** A dataset's column filter: its button's accessible name from the column's name, the value search, keep all, empty. */
  filterColumn: (column: string) => string;
  filterSearch: string;
  filterAll: string;
  filterEmpty: string;
  /** Elapsed time phrase while a response runs; `time` is already formatted as m:ss. */
  elapsed: (time: string) => string;
  /** A finished response's folded process line; `time` is the run's duration, formatted as m:ss. */
  worked: (time: string) => string;
  /** Required by a host that serves tasks (`AgentHostClientOptions.tasks`). */
  tasks?: ShellTaskLabels;
}

/** Text of the delegated work a reply shows: its task cards, its quality reviews and the reply's task list. */
export interface ShellTaskLabels {
  /** The retrieval task's executor, the retriever agent. */
  retriever: string;
  status: Record<"running" | "completed" | "failed" | "cancelled", string>;
  /** A retrieval round's branches: the metric binding results and the retriever's own. */
  branch: Record<"binding" | "retriever", string>;
  rows: (count: number) => string;
  /** The quality review's own name, beside the reply. */
  review: string;
  reviewRunning: string;
  reviewFailed: string;
  /** A score in the folded line, e.g. "92 points"; `scoreLabel` names it in the opened review. */
  score: (score: number) => string;
  scoreLabel: string;
  conclusion: string;
  fittedQuestion: string;
  /** What the check examined: one branch's results. */
  checked: string;
  checkedBranch: Record<"binding" | "retriever", string>;
  /** A reply's entry to its delegated work, beside its process line; and the task list's own title. */
  count: (count: number) => string;
  listTitle: string;
  round: (index: number, count: number) => string;
  previousRound: string;
  nextRound: string;
  quality: string;
  /** Reasons a task did not complete, by the code its owner gave; other codes show their own message. */
  errors: Record<string, string>;
}

export interface OpenArtifact {
  key: string;
  artifact: RuntimeArtifact;
  title: string;
}
