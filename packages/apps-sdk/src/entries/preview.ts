// The platform's preview components: a table of text cells (such as CSV or TSV parsed by `parseCsv`), a whole HTML
// document in a sandboxed frame, and an embedded application preview hosted through the platform's `PanelPreviewHost`.
export { TablePreview, parseCsv, type TableData, HtmlPreview } from "@ontomato/foundation-ui/preview";
export { default as AppPreview } from "../preview/AppPreview.vue";
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
} from "../preview/panel-preview";
