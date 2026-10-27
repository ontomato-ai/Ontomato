import type { AgentTool } from "../../../../../core/agent-loop/index";
import type { DiagnosisCallerIdentity } from "./caller-identity";
import { collectTurnArtifacts } from "../../workspaces/collect";
import { tApp } from "../../../../../i18n";

/** Diagnosis still uses the legacy loop; collection itself belongs to the workspace service. */
export function createCollectTurnArtifactsTool(
  caller: DiagnosisCallerIdentity,
): AgentTool {
  return {
    name: "collect_turn_artifacts",
    description: tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.0"),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        turnKey: {
          type: "string",
          description: tApp(
            "diag.observe.agent.tools.collect-turn-artifacts-tool.1",
          ),
        },
      },
      required: ["turnKey"],
    },
    async execute(_id, params, signal) {
      return {
        content: [
          {
            type: "text",
            text: await collectTurnArtifacts(
              caller,
              typeof params.turnKey === "string" ? params.turnKey.trim() : "",
              signal,
            ),
          },
        ],
      };
    },
  };
}
