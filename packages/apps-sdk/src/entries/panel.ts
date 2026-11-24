// The panel a module of this SDK version mounts through (overall design 3.3, 3.4): its declaration, its own context,
// the projections it composes, and the operations it offers. A panel's `panel.mjs` imports
// `definePanel` and `mountPanel` from here and writes nothing about page context, deep links, or buttons.
export { panelManifestSchema, definePanel, panelOperationId } from "@ontomato/contracts/panel-manifest";
/** Build a panel address with flat named query parameters (e.g. `panelAddress("/ontology/objects", { selected: id })`). */
export { panelAddress } from "@ontomato/contracts/panel-host";
export type {
  PanelManifest,
  PanelOperation,
  PanelOperationKind,
  PanelState,
  PanelStateField,
  PanelStateOperation,
  PanelStateValue,
} from "@ontomato/contracts/panel-manifest";
export type { PageContext, PageSelection } from "@ontomato/contracts/page-context";
export type { PanelDefinitionContent } from "@ontomato/contracts/product-panels";
export { mountPanel, type PanelComponent, type PanelMount } from "../panel/mount";
export { default as Projection } from "../panel/Projection.vue";
export { useProjectionSlot, useProjectionForm } from "../panel/context";
export { registerHandler, handlerFor, registeredHandlers, type RegisteredHandler } from "../panel/handlers";
export {
  usePanelContext,
  type PanelBackHandlerRegistration,
  type PanelContext,
  type ProjectionSlot,
} from "../panel/context";
export {
  usePanelBack,
  type PanelBackHandle,
  type UsePanelBackOptions,
} from "../panel/back";
export {
  usePanelFormDraft,
  type PanelFormDraftControls,
  type UsePanelFormDraftOptions,
} from "../panel/form-draft";
export type { PageHeaderDraft, PageHeaderLabels } from "../base/page-header-types";
export type { AppMenuGroup, AppMenuIcon, AppMenuItem } from "../base/app-menu-types";
export type { PanelInstance } from "../panel/instance";
export { applyPanelRequest } from "../panel/instance";
export { defineComponentMeta } from "../components";
export type { ComponentCatalogue, ComponentMetadata, ComponentPort, ComponentPorts, ComponentRole } from "../components";
export type { PanelFormAdapter, PanelFormHandle } from "../panel/forms";
export type { PanelOperationBinding } from "../panel/types";
export type { PanelProjectionRegistration, ProjectionPorts } from "../panel/ports";
export type { MemberOperations, MemberOperationsState } from "../panel/member-operations";
export { useMember, useMemberOperations, useMemberOutput, useMemberParam } from "../panel/member";
export { usePanelOutput, usePanelOutputs } from "../panel/panel-output";
export { useFormFieldSlot, useListRowSlot, type FormFieldSlotContext, type ListRowSlotContext, type ListRowSlotOperation } from "../panel/slot-context";
export {
  usePanelOperation,
  type PanelOperationAvailability,
  type PanelOperationContext,
  type PanelOperationHandle,
  type UsePanelOperationOptions,
} from "../panel/panel-operation";
export { ElMessageBox as SdkMessageBox } from "element-plus/es/components/message-box/index";
export { savePanelFile, type PanelDownloadReceipt } from "../panel/save-file";
export { usePanelNarrow, type UsePanelNarrowOptions } from "../panel/panel-narrow";
export type { PanelStateStore } from "../panel/state";
/**
 * The platform's icon for an application's icon key, as its navigation draws it (an unknown key draws the platform's
 * fallback): a panel shows an application by `<component :is="appIcon(key)">`, never by the key's text.
 */
export { appIcon } from "@ontomato/platform-shell";
