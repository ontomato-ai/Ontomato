/*
 * The SDK's part of a panel the platform runs in its own document: the platform runs the panel's module on its own SDK
 * through `panelModuleFor`, whose `mountPanel` mounts the panel's component with an instance that reads each member's
 * data through the platform's read port.
 */
export type { DirectPanelMount, DirectPanelMountOptions } from "./panel/direct-mount";
export {
  createDirectPanelInstance, type DirectPanelInstance, type DirectPanelInstanceOptions, type DirectProjectionReadOptions,
  type MemberDataState, type MemberReadyData, type PanelOperationAffected,
  type PanelMemberReadRequest, PanelMemberUnavailable, type MemberPlacing, type NestedPanelMount,
} from "./panel/direct";
export { panelModuleFor, type DirectPanelComponentPort, type DirectPanelModuleExports } from "./panel/direct-run";
export { preloadCatalogueComponents } from "./catalogue-components";
export { memberComponentId } from "./panel/projection-element";
export { panelHumanOperations, type ConfirmPanelOperation, type PanelHumanOperations } from "./panel/human-operations";
export type { PlatformRequests } from "./panel/platform-objects";
export { readProjectionForRender } from "./panel/platform-requests";

export { useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam, useMemberRead } from "./panel/member";
export { usePanelOutput, usePanelOutputs } from "./panel/panel-output";
export { useFormFieldSlot, useListRowSlot, type FormFieldSlotContext, type ListRowSlotContext, type ListRowSlotOperation } from "./panel/slot-context";
export {
  computeDraftBaselineHash,
  createMemoryLocalDraftStore,
  localDraftStoreKey,
  objectDraftKey,
  objectDraftPrefix,
  stripSecretDraftValues,
  typeDraftKey,
  useLocalDraftStore,
  type PanelLocalDraftRecord,
  type PanelLocalDraftStore,
} from "./panel/local-drafts";
export {
  usePanelOperation,
  type PanelOperationAvailability,
  type PanelOperationContext,
  type PanelOperationHandle,
  type UsePanelOperationOptions,
} from "./panel/panel-operation";
export {
  panelPreviewHostKey,
  usePanelPreviewHost,
  type AppPreviewContext,
  type AppPreviewSelectionItem,
  type AppPreviewStatus,
  type AppPreviewStatusPayload,
  type PanelPreviewHost,
  type PanelPreviewMountHandle,
  type PanelPreviewOutcome,
  type PanelPreviewRequest,
} from "./preview/panel-preview";
