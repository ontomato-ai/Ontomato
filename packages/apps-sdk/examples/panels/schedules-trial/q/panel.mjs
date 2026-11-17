import { definePanel, mountPanel } from "@ontomato/sdk/panel";
import declaration from "./declaration.mjs";

/*
 * Panel Q: the same summary projection as P, and nothing of P. It shows one task, the one the address it was opened at
 * named, and keeps that choice to itself.
 */

export const manifest = definePanel(declaration);

/** No template, so the panel's HTML is the component; `<projection slot="summary"/>` draws the one projection. */
const Panel = {
  setup() {
    return {};
  },
};

await mountPanel(Panel);
