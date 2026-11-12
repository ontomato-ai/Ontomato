import { skillRegistryManager } from "../../core/skills/registry/manager";
import { prepareAssistantSkills } from "../assistant/skills";
import { skillReference } from "./skill-manager";
import { withDomainSkills } from "./operations";
import { userSkillEnvironment, type AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { codeExecutionRequestSchema, codeExecutionSchema, codeExecutionVirtualAddressSpaceBytes } from "@ontomato/contracts/agent-runtime-code";
import { randomUUID } from "node:crypto";
import { HttpError } from "../../utils/errors";

/** Visualization execution belongs to the runtime; the workbench only selects the domain skill and reads its artifact. */
export async function renderObjectView(owner: { domainId: string; userId: string }, credentials: AssistantCredentials, id: string, input: Record<string, unknown>) {
  const client = new RuntimeClient(owner.domainId, undefined, owner.userId);
  const idempotencyKey = randomUUID();
  let execution = await withDomainSkills(owner.domainId, async () => {
    const registry = await skillRegistryManager.forDomain(owner.domainId);
    const skill = registry.getSkillById(id);
    if (!skill || skill.manifest.type !== "executable" || skill.manifest.category !== "visualization") throw new HttpError(404, "Visualization skill not found");
    const skills = await prepareAssistantSkills(owner.domainId, [skillReference(skill, owner.domainId)]);
    const request = codeExecutionRequestSchema.parse({
      language: "python", locale: credentials.locale || "en",
      files: [{ path: "input.json", content: JSON.stringify({ ...input, locale: credentials.locale }) }, {
        path: "render.py", content: `import os, subprocess\nfrom pathlib import Path\nroot = os.environ["PYTHONPATH"].split(os.pathsep)[0]\nscript = "import {execute} from " + repr(Path(root, "index.mjs").as_uri()) + "; import fs from 'node:fs'; const r=await execute(JSON.parse(fs.readFileSync('input.json','utf8'))); if(!r.html || r.meta?.error) throw new Error('Visualization failed'); fs.writeFileSync('result.html',r.html);"\nsubprocess.run(["node", "--input-type=module", "-e", script], check=True)\n`,
      }],
      entry: "render.py", arguments: [], outputPaths: ["result.html"],
      environment: userSkillEnvironment(credentials), libraries: [{ skill: skills[0], path: "scripts" }],
      limits: { wallTimeMs: 120000, memoryBytes: codeExecutionVirtualAddressSpaceBytes },
    });
    const admission = await client.request("/v1/code-executions", "POST", request, idempotencyKey) as { execution: unknown };
    return codeExecutionSchema.parse(admission.execution);
  });
  const deadline = Date.now() + 130000;
  while (execution.status !== "stopped") {
    if (Date.now() > deadline) {
      await client.request(`/v1/code-executions/${execution.id}/cancel`, "POST", {});
      throw new HttpError(504, "Visualization execution timed out");
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    execution = codeExecutionSchema.parse(await client.request(`/v1/code-executions/${execution.id}`));
  }
  if (execution.exitCode !== 0 || execution.errorMessage) throw new HttpError(422, execution.errorMessage || "Visualization skill did not produce HTML");
  return { html: await client.text(`/v1/code-executions/${execution.id}/outputs/result.html`) };
}
