import { mountPanel } from "@ontomato/sdk/panel";

/*
 * Panel Q: the same summary projection as P, and nothing of P. It shows one task, the one the address it was opened at
 * named, and keeps that choice to itself.
 *
 * One import and no file, as P does: the panel's record carries the manifest, and a relative path would not resolve
 * inside the frame.
 */

/** No template, so the panel's HTML is the component; `<projection slot="summary"/>` draws the one projection. */
const Panel = {
  setup() {
    return {};
  },
};

await mountPanel(Panel);
