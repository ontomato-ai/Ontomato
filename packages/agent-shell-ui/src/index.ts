export { default as AgentShell } from "./components/AgentShell.vue";
export { default as ToolStep } from "./components/ToolStep.vue";
export { defaultChartTheme, type ChartTheme } from "./chart-theme";
export {
  createAgentHostClient,
  type AgentHostClient,
  type AgentHostClientOptions,
  type HostAgent,
  type HostRun,
  type HostRunSnapshot,
  type HostSession,
  type HostSessionPage,
  type HostSessionSnapshot,
} from "./host";
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
