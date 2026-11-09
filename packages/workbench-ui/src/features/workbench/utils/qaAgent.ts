import { QA_AGENT_LINEUP_ID } from "@ontomato/contracts/analysis-agent";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import type { WorkbenchAgent } from "../types";

/**
 * The Q&A entry is not an analysis agent: its name, description and avatar come from the
 * domain's workbench appearance, falling back to the built-in texts.
 */
export function createQaAgent(
  appearance: WorkbenchAppearance | null,
  t: (key: string) => string
): WorkbenchAgent {
  return {
    id: QA_AGENT_LINEUP_ID,
    name: appearance?.qa.name || t("chat.queryAgent"),
    description: appearance?.qa.description || t("chat.queryAgentDesc"),
    icon: JSON.stringify({
      key: appearance?.qa.avatarKey || "MessageSquare",
      color: appearance?.qa.avatarColor || "",
    }),
    isQA: true,
    graphScope: { mode: "panorama" },
    summarizerPrompt: "",
    conclusionMakerPrompt: "",
    isEnabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}
