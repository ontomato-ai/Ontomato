import { mountPanel } from "@ontomato/sdk/panel";

/*
 * Panel P: one of the reader's scheduled tasks, its summary, its application's form, and the button that runs it now.
 * The declaration says what the panel keeps and composes; everything else — reading a projection, drawing it, registering
 * its ports, taking a draft, running an operation — is the SDK's.
 *
 * The module imports one specifier and no file: a panel's content is three texts (HTML, this module, and optionally its
 * recipes), and a relative path here would resolve against the platform's own document rather than beside this file. The
 * declaration is not read here either: the platform hands the panel's current record to the frame, and its manifest is
 * that record's. `p/declaration.mjs` is the registration script's, which is where the record's manifest comes from.
 */

/** No template and no render function, so the panel's HTML is the component: `<projection slot="…"/>` in it is the SDK's. */
const Panel = {
  setup() {
    return {};
  },
};

await mountPanel(Panel);
