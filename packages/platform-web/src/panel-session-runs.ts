import { useSessionRunFeed } from "@ontomato/agent-shell-ui";
import { AGENT_SESSION } from "@ontomato/contracts/platform-object-types";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import type { PanelObjectChange } from "./panel-host";

export function usePanelSessionRuns(enabled: () => boolean, changed: (change: PanelObjectChange) => void) {
  let client: ReturnType<typeof createAssistantClient> | undefined;
  return useSessionRunFeed({
    port: () => (client ??= createAssistantClient()).sessionRuns,
    enabled,
    sessions: () => [],
    presentation: true,
    onNotice(frame) {
      if (frame.type === "ready") return;
      const target = { objectType: AGENT_SESSION, primaryKey: frame.sessionId };
      changed({ target, affected: { objectTypes: [AGENT_SESSION], objects: [target] } });
    },
    onError: error => console.error(error),
  });
}

export type PanelSessionFeed = ReturnType<typeof usePanelSessionRuns>;
