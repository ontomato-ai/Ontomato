// The agent conversation: embeddable official conversation and artifact preview blocks, client utilities and shell labels.
export { default as AgentChat } from "../chat/AgentChat.vue";
export { default as AgentArtifactPreview } from "../chat/AgentArtifactPreview.vue";
export {
  AgentAvatar,
  AgentPicker,
  agentAvatar,
  avatarIconOptions,
  avatarSwatch,
  createAgentHostClient,
  darkAvatarColorOptions,
  lightAvatarColorOptions,
  panelChatHostKey,
  storedAgentAvatar,
  useConversationContinuation,
  usePanelChatHost,
  type AgentArtifactTarget,
  type AgentHostAgent,
  type AgentHostClient,
  type AgentHostClientOptions,
  type AgentHostWorkspaceScope,
  type AgentRunComplete,
  type ArtifactLinkSlotScope,
  type ArtifactPresentation,
  type ArtifactRendererOverride,
  type ArtifactRendererProps,
  type ArtifactSlotScope,
  type ConversationInputRun,
  type MessageActionContext,
  type PanelChatHost,
  type ShellFeedbackPort,
  type ShellFeedbackTarget,
  type ShellFeedbackValue,
  type ShellLabels,
} from "@ontomato/agent-shell-ui";
export { createAssistantClient } from "../chat";
export { useShellLabels } from "@ontomato/workbench-ui/composables/useShellLabels";
