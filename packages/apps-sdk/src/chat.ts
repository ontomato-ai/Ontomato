import { createAssistantClient as createWorkbenchAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { contextTransport, type AppContext } from "./context";

/**
 * The conversation client of the platform's agents, as the app's user: the same agents and conversations the user has
 * in the platform. Pass it to `<agent-chat>` or `<agent-shell>`.
 */
export function createAssistantClient(context: AppContext) {
  const transport = contextTransport(context);
  // A result table can show more attachments than the frame bridge admits in flight.
  let vectorRead = Promise.resolve();
  return createWorkbenchAssistantClient((path, init) => {
    if (!path.startsWith("/data-query/")) return transport.request(path, init, "");
    const next = vectorRead.then(() => {
      init.signal?.throwIfAborted();
      return transport.request(path.slice("/data-query".length), init, "/data-query");
    });
    vectorRead = next.then(() => {}, () => {});
    return next;
  });
}
