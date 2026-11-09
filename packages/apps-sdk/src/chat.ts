import { createAssistantClient as createWorkbenchAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { contextTransport, type AppContext } from "./context";

/**
 * The conversation client of the platform's agents, as the app's user: the same agents and conversations the user has
 * in the platform. Pass it to `<agent-chat-panel>` or `<agent-shell>`.
 */
export function createAssistantClient(context: AppContext) {
  const transport = contextTransport(context);
  return createWorkbenchAssistantClient((path, init) => transport.request(path, init, ""));
}
