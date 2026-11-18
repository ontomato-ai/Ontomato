import { definePanel, mountPanel } from "@ontomato/sdk/panel";
import declaration from "./declaration.mjs";

/*
 * Panel P: one of the reader's scheduled tasks, its summary, its application's form, and the button that runs it now.
 * The declaration says what the panel keeps and composes; everything else — reading a projection, drawing it, registering
 * its ports, taking a draft, running an operation — is the SDK's.
 */

/** The declaration, checked once by the SDK as the panel mounts. */
export const manifest = definePanel(declaration);

/**
 * The panel's component. It has no template and no render function, so the panel's HTML is its template: the layout is
 * the HTML's, and `<projection slot="…"/>` in it is the SDK's global component.
 */
const Panel = {
  setup() {
    return {};
  },
};

await mountPanel(Panel);
