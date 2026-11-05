import type { BrandColors, BrandSource } from "./index";

/**
 * The open-source edition's brand: the only place its colours are written (docs/design/DESIGN.md, open-source brand
 * layer). The workbench theme and the Ontology Service presentation are both generated from it.
 */

/** The light palette, without the platform shell's bands: those are references into this palette, never new values. */
const lightPalette = {
  canvas: "#f8f8f4",
  surface: "#ffffff",
  raised: "#ffffff",
  sunken: "#f1f2ec",
  hover: "#eef1e8",
  line: "#e2e5dc",
  lineStrong: "#d8dcd1",
  ink: "#282c25",
  ink2: "#3d4238",
  muted: "#62665c",
  placeholder: "#6c7166",
  faint: "#8a8f82",
  primary: "#42613f",
  primaryHover: "#36512f",
  primaryPress: "#2c4327",
  onPrimary: "#ffffff",
  primarySoft: "#e8ede3",
  brandMark: "#639c2d",
  accent: "#dc4b35",
  accentInk: "#bc3928",
  accentSoft: "#f3e5dd",
  success: "#3d7a1a",
  warning: "#946000",
  danger: "#bc3928",
  info: "#62665c",
} satisfies Omit<BrandColors, "rail" | "panel" | "workspace" | "railSelected" | "panelSelected">;

/** The dark palette, without the shell bands for the same reason. */
const darkPalette = {
  canvas: "#161814",
  surface: "#1c1f1a",
  raised: "#242822",
  sunken: "#121410",
  hover: "#262a23",
  line: "#2c3128",
  lineStrong: "#3a4035",
  ink: "#e9ece3",
  ink2: "#cfd4c6",
  muted: "#a3a99a",
  placeholder: "#8f9586",
  faint: "#7d8376",
  primary: "#8fbf5a",
  primaryHover: "#a0cb6e",
  primaryPress: "#7dad49",
  onPrimary: "#14180f",
  primarySoft: "#2c3527",
  brandMark: "#8fbf5a",
  accent: "#ef7b65",
  accentInk: "#ef7b65",
  accentSoft: "#3a231d",
  success: "#7dbb4b",
  warning: "#d9a441",
  danger: "#ef7b65",
  info: "#a3a99a",
} satisfies Omit<BrandColors, "rail" | "panel" | "workspace" | "railSelected" | "panelSelected">;

export const ossBrand: BrandSource = {
  light: {
    ...lightPalette,
    // The platform shell's bands borrow the existing steps (DESIGN.md "Colour"): the rail is the sunken step, the panel
    // the page background, the workspace the surface, and both selected fills the sage of the selected state. No new
    // colour is introduced; these are references, so a change to a step moves the band with it.
    rail: lightPalette.sunken,
    panel: lightPalette.canvas,
    workspace: lightPalette.surface,
    railSelected: lightPalette.primarySoft,
    panelSelected: lightPalette.primarySoft,
  },
  dark: {
    ...darkPalette,
    // Dark reverses the order with the same steps: the rail is the raised step, the panel the surface, the workspace
    // the page background.
    rail: darkPalette.raised,
    panel: darkPalette.surface,
    workspace: darkPalette.canvas,
    railSelected: darkPalette.primarySoft,
    panelSelected: darkPalette.primarySoft,
  },
  dataviz: {
    light: ["#4a8f1f", "#3d6fd1", "#b97d08", "#0f9488", "#d4553c", "#9b4fb5", "#7a7f1a", "#d24d8a"],
    dark: ["#68a03b", "#6a8fe0", "#b98820", "#2ba597", "#dc6e58", "#a970c8", "#919530", "#d86b9c"],
  },
};
