export { default as AgentShell } from "./components/AgentShell.vue";
export { default as AgentChat } from "./components/AgentChat.vue";
export { default as ShellComposer } from "./components/ShellComposer.vue";
export { default as PageComposer } from "./components/PageComposer.vue";
export { default as ShellDockRoom } from "./components/ShellDockRoom.vue";
export { default as AgentAvatar } from "./components/AgentAvatar.vue";
export { default as AgentPicker } from "./components/AgentPicker.vue";
export {
  agentAvatar,
  avatarIconOptions,
  avatarSwatch,
  darkAvatarColorOptions,
  lightAvatarColorOptions,
  storedAgentAvatar,
} from "./avatar";
export { default as ShellNavBody } from "./components/ShellNavBody.vue";
export { default as ShellColumn } from "./components/ShellColumn.vue";
export { default as ToolStep } from "./components/ToolStep.vue";
export { pageDockSpaceKey, pagePaneElementKey, useConversationContinuation, usePageDockSpace } from "./context";
export { pageContextLine, pageLineAddress, pageMoved, samePageAddress, writtenText, type PageContext, type PageFormSnapshot, type PageHighlight, type PageLinePrompts, type PageSelection } from "./page-context";
export { pageCounterKey, usePageCounter, type PageCounter } from "./page-counter";
export { panelChatHostKey, usePanelChatHost, type PanelChatHost } from "./panel-chat";
export { entryAgent, servePageComposerKey, type ComposerEntry, type EntryAgentResolution, type PageComposerExpand, type PageComposerRequest, type ServePageComposer } from "./page-composer-entry";
export {
  displayLink,
  useConversationDisplay,
  type ConversationDisplay,
  type ConversationDisplayHost,
  type DisplayHistory,
  type DisplayObjectChange,
  type DisplayObjectRefresh,
  type DisplayPage,
  type DisplayPageAdmissionResult,
  type DisplayPageController,
  type DisplayStateUpdate,
  type DisplayTarget,
  type DisplayView,
} from "./conversation-display";
export { useAgentNav, type AgentNav, type AgentNavOptions } from "./useAgentNav";
export { useSessionRunFeed, type SessionRunFeedOptions } from "./useSessionRunFeed";
export { vectorResourceTarget, type ReadVectorResource } from "./vector-resource";
export {
  createAgentHostClient,
  type AgentHostClient,
  type AgentHostClientOptions,
  type AgentHostWorkspaceScope,
  type SessionRunHandlers,
  type SessionRunPort,
} from "./host";
export type { PageSkillContext } from "@ontomato/contracts/page-context";
export type { AgentHostAgent } from "@ontomato/contracts/agent-host";
export type {
  ArtifactPresentation,
  ArtifactRendererOverride,
  ArtifactRendererProps,
  MessageActionContext,
  ProcessStepView,
  ShellBottomEntry,
  ShellFeatureDeclaration,
  ShellFeedbackPort,
  ShellFeedbackTarget,
  ShellFeedbackValue,
  ShellLabels,
  ShellPanelOperationsPort,
  ShellRunChange,
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
  ToolStepProps,
} from "./types";

export { pageSessionStream, sessionRunNotices } from "./session-run-notices";
