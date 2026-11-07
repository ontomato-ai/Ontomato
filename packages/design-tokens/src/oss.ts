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
  accent: "#ed593e",
  accentInk: "#c13d27",
  accentSoft: "#fff0e9",
  success: "#247b2a",
  warning: "#9a5c00",
  danger: "#c23827",
  info: "#62665c",
} satisfies Omit<BrandColors, "rail" | "panel" | "workspace" | "railSelected" | "panelSelected" | "edge">;

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
  accent: "#ff9478",
  accentInk: "#ffab92",
  accentSoft: "#402820",
  success: "#98d768",
  warning: "#efbd59",
  danger: "#ff917d",
  info: "#a3a99a",
} satisfies Omit<BrandColors, "rail" | "panel" | "workspace" | "railSelected" | "panelSelected" | "edge">;

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
    // The hairline between the rail and an application's surface: a tint of the palette's ink, never an opaque colour.
    edge: "rgba(40, 44, 37, 0.08)",
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
    edge: "rgba(233, 236, 227, 0.08)",
  },
  dataviz: {
    light: ["#4a8f1f", "#3d6fd1", "#b97d08", "#0f9488", "#d4553c", "#9b4fb5", "#7a7f1a", "#d24d8a"],
    dark: ["#98d768", "#88adff", "#efbd59", "#4ed0b9", "#ff917d", "#c995ed", "#c0cd62", "#f28cbb"],
  },
};
