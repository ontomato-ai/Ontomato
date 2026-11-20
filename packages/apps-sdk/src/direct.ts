/*
 * The SDK's part of a panel drawn directly in the platform's own document: the platform lays out the panel and runs it
 * through `mountDirectPanel`, which draws each member and reads its data through the platform's read port.
 */
export { mountDirectPanel, type DirectPanelMount, type DirectPanelMountOptions } from "./panel/direct-mount";
export {
  createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions, type MemberDataState, type PanelOperationAffected,
  type PanelMemberReadRequest,
} from "./panel/direct";
export { panelModuleFor, type DirectPanelComponentPort, type DirectPanelModuleExports } from "./panel/direct-run";
export { default as PanelMember } from "./panel/PanelMember.vue";
export { panelHumanOperations, type ConfirmPanelOperation, type PanelHumanOperations } from "./panel/human-operations";
export type { PlatformRequests } from "./panel/platform-objects";
