import type { Plugin } from "vite";

/** The Vite plugin that serves `apps-sdk:panel-appearance` from the product's edition module. */
export function panelAppearance(editionSource: string): Promise<Plugin>;
