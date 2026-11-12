export { default as AgentShell } from "./components/AgentShell.vue";
export { default as DatasetSelectionButton } from "./components/DatasetSelectionButton.vue";
export { default as AgentChatPanel } from "./components/AgentChatPanel.vue";
export { default as ShellComposer } from "./components/ShellComposer.vue";
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
export { pageDockSpaceKey, useConversationContinuation, usePageDockSpace } from "./context";
export { useAgentNav, type AgentNav, type AgentNavOptions } from "./useAgentNav";
export {
  createAgentHostClient,
  type AgentHostClient,
  type AgentHostClientOptions,
  type AgentHostWorkspaceScope,
} from "./host";
export type { AgentHostAgent } from "@ontomato/contracts/agent-host";
export type {
  ArtifactPresentation,
  ArtifactRendererOverride,
  ArtifactRendererProps,
  MessageActionContext,
  ProcessStepView,
  ShellFeatureDeclaration,
  ShellFeedbackPort,
  ShellFeedbackTarget,
  ShellFeedbackValue,
  ShellLabels,
  ShellRunChange,
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
  ToolStepProps,
} from "./types";
