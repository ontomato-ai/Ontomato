import { readFile } from "node:fs/promises";
import path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  submitDatasetSchema,
  finishRetrievalSchema,
} from "@ontomato/contracts/data-retrieval";
import { workbenchServerResourceRoot } from "../../content/resources";
import { RuntimeClient } from "../agent-runtime/client";

export const retrievalSkill = {
  namespace: { kind: "provider" as const, provider: "workbench" },
  name: "data-retrieval",
  version: "1.0.0",
};
export const ontologySkill = {
  namespace: { kind: "provider" as const, provider: "ontology" },
  name: "ontomato-analyst",
  version: "2.0.0",
};
export async function registerRetrievalSkill() {
  const root = path.join(
    workbenchServerResourceRoot,
    "resources/runtime-skills/data-retrieval",
  );
  const files = await Promise.all(
    ["SKILL.md", "run.mjs"].map(async (name) => ({
      path: name,
      content: await readFile(path.join(root, name), "utf8"),
    })),
  );
  files.push({
    path: "runtime.json",
    content: JSON.stringify({
      version: retrievalSkill.version,
      tools: [
        {
          name: "submit_dataset",
          description:
            "Submit a tested recipe. The host reruns with user permissions before accepting a dataset. Use the returned submissionId in finish_retrieval.",
          entry: "run.mjs",
          inputSchema: zodToJsonSchema(submitDatasetSchema, {
            $refStrategy: "none",
          }),
        },
        {
          name: "finish_retrieval",
          description:
            "Declare completed, needs_input or failed using accepted submission IDs. Then end this run.",
          entry: "run.mjs",
          inputSchema: zodToJsonSchema(finishRetrievalSchema, {
            $refStrategy: "none",
          }),
        },
      ],
    }),
  });
  await new RuntimeClient(undefined).request("/v1/skills", "POST", {
    skill: retrievalSkill,
    files,
  });
}
