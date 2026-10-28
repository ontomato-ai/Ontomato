import path from "node:path";
import { workbenchServerResourceRoot } from "../../content/resources";
import { publishSkill } from "../agent-runtime/skills";
export async function registerAssistantSkills() {
  for (const name of ["assistant-retrieval", "assistant-report"])
    await publishSkill(
      path.join(workbenchServerResourceRoot, "resources/runtime-skills", name),
      { namespace: { kind: "provider", provider: "workbench" }, name },
    );
}
