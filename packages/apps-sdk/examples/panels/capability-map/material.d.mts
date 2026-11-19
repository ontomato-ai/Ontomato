import type { PanelManifest } from "@ontomato/contracts/panel-manifest";
import type { PanelMessages, ProductPanelContent, ProductPanelInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { workspaceFileSchema } from "@ontomato/contracts/workspaces";
import type { z } from "zod";

export const PANEL_ID: "capability-map";
export const manifest: PanelManifest;
export const messages: PanelMessages;
export const projections: readonly { id: string; input: ProductProjectionInput }[];
export function panelContent(): ProductPanelContent;
export function candidateFiles(sdkVersion: string): z.infer<typeof workspaceFileSchema>[];
export function panelInput(sdkVersion: string): ProductPanelInput;
export function projectionMaterial(): { projections: { id: string; mode: "create"; input: ProductProjectionInput }[] };
