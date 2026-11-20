import type { DirectPanelManifest, PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ApplicationPanelUse, DirectProjectionInput } from "@ontomato/contracts/product-panels";

/** The trial's projections, each a direct projection's registration input. */
export const projections: readonly { id: string; input: DirectProjectionInput }[];
/** P and Q, each a module and the declaration that goes with it (P's in its `panel.json`). */
export const panels: readonly { id: string; directory: string; manifest: DirectPanelManifest | PanelManifest; name: string; description: string }[];
export function panelContent(directory: string): { html: string; module: string; recipes?: string };
export const applications: readonly {
  applicationId: string;
  entry: { path: string; renderer: "panels" };
  entryAccess: string[];
  declaration: Record<string, unknown>;
  panelUses: ApplicationPanelUse[];
}[];
