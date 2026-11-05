export { default as AgentShell } from "./components/AgentShell.vue";
export { default as AgentChatPanel } from "./components/AgentChatPanel.vue";
export { default as ShellNavBody } from "./components/ShellNavBody.vue";
export { default as ToolStep } from "./components/ToolStep.vue";
export { useAgentNav, type AgentNav, type AgentNavOptions } from "./useAgentNav";
export {
  appColumnKey,
  createAppColumn,
  useAppColumn,
  useAppColumnOf,
  type AppColumnContribution,
} from "./app-column";
export { defaultChartTheme, type ChartTheme } from "./chart-theme";
export { createAgentHostClient, type AgentHostClient, type AgentHostClientOptions } from "./host";
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
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
  ToolStepProps,
} from "./types";
