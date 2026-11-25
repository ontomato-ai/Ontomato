// The agent conversation: the platform's own shell components, the client of its agents and its words.
export * from "@ontomato/agent-shell-ui";
export { default as AgentChatPanel } from "../chat/AgentChatPanel.vue";
export { createAssistantClient } from "../chat";
export { useShellLabels } from "@ontomato/workbench-ui/composables/useShellLabels";
