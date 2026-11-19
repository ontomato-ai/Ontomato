import type { PanelMaterial } from "../material.mjs";

type Material = PanelMaterial<"agent-settings">;
export const PANEL_ID: Material["PANEL_ID"];
export const manifest: Material["manifest"];
export const messages: Material["messages"];
export const projections: Material["projections"];
export const panelContent: Material["panelContent"];
export const candidateFiles: Material["candidateFiles"];
export const panelInput: Material["panelInput"];
export const projectionMaterial: Material["projectionMaterial"];
export const panelMaterial: Material["panelMaterial"];
