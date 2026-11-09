export { default as AgentBasicInfoFields } from "./components/AgentBasicInfoFields.vue";
export {
  avatarIconOptions,
  darkAvatarColorOptions,
  lightAvatarColorOptions,
  getAgentColor,
  getAgentIcon,
  getAgentIconComponent,
} from "./utils/agentDisplay";
export { default as WorkbenchAppearanceDialog } from "./components/WorkbenchAppearanceDialog.vue";
export { createQaAgent } from "./utils/qaAgent";
export { getWorkbenchAppearance } from "./api";
export type {
  DashboardSidebarItem,
  QAThread,
  TaskProgressState,
  WorkbenchAgent,
  WorkbenchSelectionMode,
} from "./types";
