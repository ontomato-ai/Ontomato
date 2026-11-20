import type { Component } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeRunStatus } from "@ontomato/contracts/agent-runtime-values";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";

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
  /**
   * Whether the application's column lists this page as an entry. A page declared only so the host can open it beside the
   * conversation — the settings, a dashboard — has no entry of its own and is not listed; the column has its own way to
   * the pages a reader starts from.
   */
  listed?: boolean;
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
  /**
   * The page's own address, when the platform mounts it beside a conversation: enlarging it opens that address in the
   * application that owns it, and the page keeps its own state while it sits beside the chat.
   */
  address?: string;
  /**
   * The page's own skill context: an agent is a candidate for this page's composer when its effective skills carry it.
   */
  pageSkill?: PageSkillContext;
}

/**
 * The application's own entry at the foot of its column (its settings, the model the diagnosis runs on). `page` is the
 * feature it shows in this application, when it shows one here: the entry is the column's current row while that page
 * is the one shown. An entry that leaves for another application names none.
 */
export interface ShellBottomEntry {
  label: string;
  icon: string;
  page?: string;
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
 * Whether an agent asks the conversation's owner before it runs a panel operation, kept by the host for each of its
 * conversations (new ones ask). Only the owner reads or changes it, and only for a conversation that can be the root of a
 * panel operation: `read` resolves to null where the host says the conversation offers no such choice.
 */
export interface ShellPanelOperationsPort {
  read(sessionId: string): Promise<boolean | null>;
  /** Resolves to the value the host now holds. */
  write(sessionId: string, confirmBeforeExecute: boolean): Promise<boolean>;
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
  /** The conversation menu's switch: agents ask the owner before they run a panel operation. */
  panelConfirmation: string;
  /** Marks the open conversation whose agents run panel operations without asking. */
  panelAutomatic: string;
  /** What that mark means, on hover and for assistive technology. */
  panelAutomaticHint: string;
  placeholder: string;
  send: string;
  stop: string;
  greeting: string;
  steps: (count: number) => string;
  thinking: string;
  working: string;
  /** The composer's agent choice while a reply runs: the running conversation keeps the agent it started with. */
  switchWhileRunning: string;
  /**
   * A page that declares its own skill cannot offer an agent: the reader holds no mapping for the page, or its registered
   * default agent is gone. The page shows this rather than choosing another agent.
   */
  pageAgentUnavailable: string;
  /** A composer floating over a page folds into a round button, and opens again from it. */
  collapseComposer: string;
  expandComposer: string;
  /** A message's last line names the page it was written beside: what the reader calls it, and its address. */
  pageContext: (page: { label: string; url: string }) => string;
  /** The same line for a page the shell cannot name yet (a panel's, before it reports its application's name). */
  pageContextAddress: (url: string) => string;
  /** The same line names what was selected in the page. */
  selectionContext: (selection: string) => string;
  /** The line a message ends with while a file is open beside the conversation: its title and its workspace path. */
  fileContext: (file: { label: string; path: string }) => string;
  /** The line a message ends with once the page or file its conversation was last told about is no longer shown. */
  pageContextClosed: string;
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
  /** A timeline event whose date the metric does not give. */
  chartUndated: string;
  /** A chart whose metric returned no rows. */
  noChartRows: string;
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
  /** The head of the panel over the composer, its toggle: how many of the agents' questions wait for the reader. */
  questionsWaiting: (count: number) => string;
  /** Marks the option that is the agent's default. */
  questionOptionDefault: string;
  /** The last option of every question, the reader's own answer, and its input's hint. */
  questionOptionOther: string;
  questionOtherPlaceholder: string;
  /** Hides a question here without answering it. */
  questionSkip: string;
  questionPrevious: string;
  questionNext: string;
  /** A message the reader sent while a reply ran, as the answer to one of its questions. */
  answered: (text: string) => string;
  /** Required by a host that serves tasks (`AgentHostClientOptions.tasks`). */
  tasks?: ShellTaskLabels;
}

/** Text of the delegated work a reply shows: its task cards, its quality reviews and the reply's task list. */
export interface ShellTaskLabels {
  /** The retrieval task's executor, the retriever agent. */
  retriever: string;
  status: Record<"starting" | "running" | "completed" | "failed" | "cancelled", string>;
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
  /** The caption provided by a Markdown image. */
  caption?: string;
}
