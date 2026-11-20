import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelMessages, ProductPanelContent, ProductPanelInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { WorkspaceFile } from "@ontomato/contracts/workspaces";

export interface PanelMaterial<Id extends string> {
  PANEL_ID: Id;
  manifest: PanelManifest;
  messages: PanelMessages;
  projections: readonly { id: string; input: ProductProjectionInput }[];
  panelContent(): ProductPanelContent;
  candidateFiles(): WorkspaceFile[];
  panelInput(): ProductPanelInput;
  projectionMaterial(): { projections: { id: string; mode: "create"; input: ProductProjectionInput }[] };
  panelMaterial(): { panels: { id: Id; mode: "create"; input: ProductPanelInput }[] };
  runCli(): void;
}

export function createPanelMaterial<Id extends string>(
  entryUrl: string,
  identity: { id: Id; name: string; description: string },
): PanelMaterial<Id>;
