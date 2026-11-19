import { createPanelMaterial } from "../material.mjs";

const material = createPanelMaterial(import.meta.url, {
  id: "agent-settings",
  name: "Agent settings",
  description: "The domain's agents: choose one and change its definition, or create a new one.",
});

export const {
  PANEL_ID, manifest, messages, projections, panelContent, candidateFiles, panelInput, projectionMaterial, panelMaterial,
} = material;

material.runCli();
