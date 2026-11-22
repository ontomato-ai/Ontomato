import { onBeforeUnmount } from "vue";
import { usePanelContext, type PanelDetailHeader } from "./context";

/**
 * Publishes a full-width detail view's heading and actions to the enclosing platform page header so the page renders
 * one unified bar (back to catalog, object title, and actions) rather than stacking a second titlebar inside the panel.
 * Returns `true` when the enclosing host owns the page header, or `false` in nested/headerless previews so the panel
 * can render a local fallback bar when needed.
 */
export function usePanelDetailHeader(header: () => PanelDetailHeader | null): boolean {
  const panel = usePanelContext();
  if (!panel.registerDetailHeader) return false;
  const stop = panel.registerDetailHeader(header);
  onBeforeUnmount(stop);
  return true;
}
