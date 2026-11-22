// The panel a module of this SDK version mounts through (overall design 3.3, 3.4): its declaration, its own context,
// the projections it composes, the drafts it receives and the operations it offers. A panel's `panel.mjs` imports
// `definePanel` and `mountPanel` from here and writes nothing about page context, deep links, drafts or buttons.
export { panelManifestSchema, definePanel, panelOperationId } from "@ontomato/contracts/panel-manifest";
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
export { usePanelContext, type PanelContext, type ProjectionSlot } from "../panel/context";
export type { PanelInstance } from "../panel/instance";
export { applyPanelRequest } from "../panel/instance";
export { defineComponentMeta } from "../components";
export type { ComponentCatalogue, ComponentMetadata, ComponentPort, ComponentPorts, ComponentRole } from "../components";
export type { PanelFormAdapter, ReceivedPanelDraft } from "../panel/draft";
/** Whether a received draft creates an object or edits one, and which: `draftTarget(instance.draft.value)`. */
export { draftTarget, type PageDraftObjectRef, type PageDraftTarget } from "@ontomato/contracts/page-draft";
export type { PanelOperationBinding } from "../panel/types";
export type { PanelProjectionRegistration, ProjectionPorts } from "../panel/ports";
export type { MemberOperations, MemberOperationsState } from "../panel/member-operations";
export { useMember, useMemberData, useMemberOperations, useMemberParam, useMemberRead, type PanelMemberRowOperation } from "../panel/member";
export { usePanelData } from "../panel/panel-data";
export { usePanelOperation, type PanelOperationHandle } from "../panel/panel-operation";
export { savePanelFile, type PanelDownloadReceipt } from "../panel/save-file";
export { usePanelNarrow, type UsePanelNarrowOptions } from "../panel/panel-narrow";
export type { PanelStateStore } from "../panel/state";
/**
 * The platform's icon for an application's icon key, as its navigation draws it (an unknown key draws the platform's
 * fallback): a panel shows an application by `<component :is="appIcon(key)">`, never by the key's text.
 */
export { appIcon } from "@ontomato/platform-shell";
