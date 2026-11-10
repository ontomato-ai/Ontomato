export { default as AgentShell } from "./components/AgentShell.vue";
export { default as DatasetSelectionButton } from "./components/DatasetSelectionButton.vue";
export { default as AgentChatPanel } from "./components/AgentChatPanel.vue";
export { default as ShellNavBody } from "./components/ShellNavBody.vue";
export { default as ShellColumn } from "./components/ShellColumn.vue";
export { default as ToolStep } from "./components/ToolStep.vue";
export { useConversationContinuation } from "./context";
export { continuationMessage } from "./continuation-message";
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
