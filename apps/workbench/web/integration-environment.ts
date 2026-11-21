import type { Environment } from "vitest";
import { builtinEnvironments } from "vitest/environments";

/**
 * The page's document as the web tests have it (happy-dom), for tests that also run the Node server in the same
 * process. Node's own fetch carries both the page's requests and the server's, and it takes only Node's abort signals;
 * happy-dom replaces the globals that make them. The globals keep Node's abort classes, which the page's code uses the
 * same way.
 */
export default <Environment>{
  name: "happy-dom-with-node-server",
  transformMode: "web",
  async setup(global, options) {
    const { AbortController, AbortSignal } = global;
    const environment = await builtinEnvironments["happy-dom"].setup(global, options);
    Object.assign(global, { AbortController, AbortSignal });
    return environment;
  },
};
