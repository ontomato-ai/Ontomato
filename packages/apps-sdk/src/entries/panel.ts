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
export type { ProductPanel } from "@ontomato/contracts/product-panels";
export { mountPanel, type PanelComponent, type PanelMount } from "../panel/mount";
export { usePanelContext, type PanelContext } from "../panel/context";
export type { PanelInstance } from "../panel/instance";
export type { PanelFormAdapter, ReceivedPanelDraft } from "../panel/draft";
export type { PanelOperationBinding } from "../panel/types";
export type { PanelProjectionRegistration, ProjectionOperation, ProjectionPorts } from "../panel/projection";
export type { PanelStateStore } from "../panel/state";
