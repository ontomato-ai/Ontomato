/*
 * The SDK's part of a panel the platform runs in its own document: the platform runs the panel's module on its own SDK
 * through `panelModuleFor`, whose `mountPanel` mounts the panel's component with an instance that reads each member's
 * data through the platform's read port.
 */
export type { DirectPanelMount, DirectPanelMountOptions } from "./panel/direct-mount";
export {
  createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions, type MemberDataState, type PanelOperationAffected,
  type PanelMemberReadRequest, PanelMemberUnavailable, type MemberPlacing, type NestedPanelMount,
} from "./panel/direct";
export { panelModuleFor, type DirectPanelComponentPort, type DirectPanelModuleExports } from "./panel/direct-run";
export { panelHumanOperations, type ConfirmPanelOperation, type PanelHumanOperations } from "./panel/human-operations";
export type { PlatformRequests } from "./panel/platform-objects";
export { readProjectionForRender } from "./panel/platform-requests";

export { useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam, useMemberRead } from "./panel/member";
export { usePanelOutput, usePanelOutputs } from "./panel/panel-output";
export { useFormFieldSlot, useListRowSlot, type FormFieldSlotContext, type ListRowSlotContext, type ListRowSlotOperation } from "./panel/slot-context";
export {
  usePanelOperationAction,
  type PanelOperationActionAvailability,
  type PanelOperationActionContext,
  type PanelOperationActionHandle,
  type UsePanelOperationActionOptions,
} from "./panel/panel-operation";
