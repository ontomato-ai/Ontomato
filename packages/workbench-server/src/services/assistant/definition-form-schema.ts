import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { assistantAgentPanelValuesSchema as inputSchema, assistantAgentPanelUpdateValuesSchema as updateSchema } from "@ontomato/contracts/assistant-chat";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldPointer, type FormFieldError } from "@ontomato/contracts/form-fields";
import type { PanelFormDescription } from "@ontomato/contracts/panel-projection";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import { HttpError } from "../../utils/errors";

export const agentFormJsonSchema = (schema: z.ZodTypeAny) => runtimeJsonObjectSchema.parse(
  zodToJsonSchema(schema, { $refStrategy: "none", effectStrategy: "input" }),
);
const createBody = agentFormJsonSchema(inputSchema);
const updateBody = agentFormJsonSchema(updateSchema);
const formPath = "/assistant/agent-definitions";

export class AgentDefinitionFieldError extends HttpError {
  declare readonly code: string;

  constructor(status: number, message: string, code: string, readonly errors: FormFieldError[]) {
    super(status, message, code, { errors });
  }

  static fromOption(error: HttpError, field: string, code: FormFieldError["code"]) {
    return new AgentDefinitionFieldError(error.status, error.message, error.code ?? "INVALID_REQUEST", [
      { field, code, message: error.message },
    ]);
  }
}

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
  const errors = parsed.error.issues.flatMap<FormFieldError>(issue => {
    const path = issue.path.map(key => formFieldPointer("/", String(key))).join("");
    return issue.code === "unrecognized_keys"
      ? issue.keys.map(key => ({ field: path + formFieldPointer("/", key), code: "invalid_option", message: issue.message }))
      : [{
        field: path || "/",
        code: issue.code === "invalid_type" && issue.received === "undefined" ? "required" : "invalid_option",
        message: issue.message,
      }];
  });
  throw new AgentDefinitionFieldError(400, "Invalid agent definition form", "INVALID_REQUEST", errors);
}
