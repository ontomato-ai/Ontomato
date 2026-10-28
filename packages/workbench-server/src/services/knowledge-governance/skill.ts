import { readFile } from "node:fs/promises";
import path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { workbenchServerResourceRoot } from "../../content/resources";
import { RuntimeClient } from "../agent-runtime/client";
import { governanceActions } from "./tools";

export const governanceSkillRef = {
  namespace: { kind: "provider" as const, provider: "workbench" },
  name: "knowledge-governance",
  version: "2.0.0",
};
export async function registerGovernanceSkill() {
  const root = path.join(
    workbenchServerResourceRoot,
    "resources/runtime-skills/knowledge-governance",
  );
  const manifest = {
    version: governanceSkillRef.version,
    contextEntry: "run.mjs",
    tools: Object.entries(governanceActions).map(([name, action]) => ({
      name,
      description: action.description,
      entry: "run.mjs",
      inputSchema: zodToJsonSchema(action.schema, { $refStrategy: "none" }),
    })),
  };
  const files = await Promise.all(
    ["SKILL.md", "run.mjs"].map(async (name) => ({
      path: name,
      content: await readFile(path.join(root, name), "utf8"),
    })),
  );
  files.push({ path: "runtime.json", content: JSON.stringify(manifest) });
  await new RuntimeClient(undefined).request("/v1/skills", "POST", {
    skill: governanceSkillRef,
    files,
  });
}
