import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { assistantAgentPanelValuesSchema as inputSchema, assistantAgentPanelUpdateValuesSchema as updateSchema } from "@ontomato/contracts/assistant-chat";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldPointer } from "@ontomato/contracts/form-fields";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import { HttpError } from "../../utils/errors";

export const agentFormJsonSchema = (schema: z.ZodTypeAny) => runtimeJsonObjectSchema.parse(
  zodToJsonSchema(schema, { $refStrategy: "none", effectStrategy: "input" }),
);
const createBody = agentFormJsonSchema(inputSchema);
const updateBody = agentFormJsonSchema(updateSchema);
const formPath = "/assistant/agent-definitions";

export function agentDefinitionSave(target: PanelFormTarget): PanelFormDescription["save"] {
  return target.kind === "draft"
    ? { method: "POST", path: formPath, draftOperation: "agent.create", bodySchema: createBody }
    : { method: "PUT", path: `${formPath}/${target.primaryKey}`, draftOperation: "agent.update", bodySchema: updateBody };
}

export function parseAgentDefinitionForm(values: unknown) {
  return parseForm(inputSchema, values);
}

export function parseAgentDefinitionUpdateForm(values: unknown) {
  return parseForm(updateSchema, values);
}

function parseForm<T extends z.ZodTypeAny>(schema: T, values: unknown): z.output<T> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.flatMap(issue => {
    const path = issue.path.map(key => formFieldPointer("/", String(key))).join("");
    return issue.code === "unrecognized_keys"
      ? issue.keys.map(key => ({ field: path + formFieldPointer("/", key), message: issue.message }))
      : [{ field: path, message: issue.message }];
  });
  throw new HttpError(400, "Invalid agent definition form", "INVALID_REQUEST", { fields });
}
