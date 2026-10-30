import type { Component } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";

export type ArtifactPresentation = "inline" | "panel";

/** Props of every artifact renderer; the same renderer serves inline and panel views. */
export interface ArtifactRendererProps {
  artifact: RuntimeArtifact;
  title: string;
  presentation: ArtifactPresentation;
  read: () => Promise<Blob>;
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

/** Context passed to the host's message action slot. */
export interface MessageActionContext {
  sessionId: string;
  runId: string;
  messageId: string;
  text: string;
}

/** Fixed shell text supplied by the host's i18n. */
export interface ShellLabels {
  newConversation: string;
  agent: string;
  sessions: string;
  noSessions: string;
  more: string;
  loadFailed: string;
  retry: string;
  deleteSession: string;
  deleteConfirm: string;
  unavailable: string;
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
  scrollToBottom: string;
  loading: string;
  rows: (count: number) => string;
  emptyFile: string;
  invalidChart: string;
  previousPage: string;
  nextPage: string;
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
  activityRetrieve: string;
  activityDataset: string;
  activityCompute: string;
  /** A finished response's status line. */
  done: string;
  /** Elapsed time phrase; `time` is already formatted as m:ss. */
  elapsed: (time: string) => string;
}

export interface OpenArtifact {
  key: string;
  artifact: RuntimeArtifact;
  title: string;
}
