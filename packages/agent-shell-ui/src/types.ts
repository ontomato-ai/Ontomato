import type { Component } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";

export type ArtifactPresentation = "inline" | "panel";

/** Props every host artifact renderer receives; the same renderer serves inline and panel views. */
export interface ArtifactRendererProps {
  artifact: RuntimeArtifact;
  title: string;
  presentation: ArtifactPresentation;
  read: () => Promise<Blob>;
}

/** Host registration: the shell picks the longest matching extension. */
export interface ArtifactRendererRegistration {
  extensions: string[];
  component: Component;
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
}

export interface OpenArtifact {
  key: string;
  artifact: RuntimeArtifact;
  title: string;
}
