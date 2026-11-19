import { z } from "zod";
import { agentHostErrorSchema } from "@ontomato/contracts/agent-host";
import { assistantAgentDefinitionSchema } from "@ontomato/contracts/assistant-chat";
import { AGENT_DEFINITION, DELETE_AGENT } from "@ontomato/contracts/panel-client-requests";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { HttpError } from "../../utils/errors";
import type { PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation } from "../product-panels/server-operations";
import { agentDefinitionSave, parseAgentDefinitionForm } from "./definition-form-schema";
import { resolveAssistantSkillReferences } from "./skill-references";

const targetSchema = panelFormTargetSchema.options[0].extend({
  objectType: z.literal(AGENT_DEFINITION),
  primaryKey: z.string().uuid(),
}).strict();
const inputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();

async function refusal(response: Response) {
  return agentHostErrorSchema.parse(await response.json()).error;
}

export const agentDefinitionOperations = [
  {
    handlerRef: `${AGENT_DEFINITION}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: AGENT_DEFINITION },
    targetType: AGENT_DEFINITION,
    targetSchema: z.discriminatedUnion("kind", [targetSchema, panelFormTargetSchema.options[1]]),
    inputSchema,
    draftOperation: (target: PanelOperationTarget) => agentDefinitionSave(target).draftOperation,
    draftInput: (input: Record<string, unknown>) => parseAgentDefinitionForm(inputSchema.parse(input).values),
    formInstructions: "Read the definition form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues(values: unknown, domainId: string) {
        const input = parseAgentDefinitionForm(values);
        return { ...input, skills: resolveAssistantSkillReferences(input.skills, domainId), executionUserId: input.executionUserId ?? null };
      },
      createdObject: (data: unknown) => ({ objectType: AGENT_DEFINITION, primaryKey: assistantAgentDefinitionSchema.parse(data).id }),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<PanelOperationOutcome> {
      const save = agentDefinitionSave(target);
      const response = await host.requestWorkbench(save.path, {
        method: save.method,
        headers: save.method === "POST" ? { "Idempotency-Key": intentId } : {},
        body: JSON.stringify(parseAgentDefinitionForm(inputSchema.parse(input).values)),
      });
      if (!response.ok) return { kind: "failure", ...await refusal(response) };
      return { kind: "success", data: assistantAgentDefinitionSchema.parse(await response.json()) };
    },
  },
  {
    handlerRef: DELETE_AGENT,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_AGENT },
    targetType: AGENT_DEFINITION,
    targetSchema,
    inputSchema: z.object({}).strict(),
    async targetLabel(host: PanelOperationHost, target: PanelRecordTarget) {
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "GET" });
      if (!response.ok) {
        const { code, message } = await refusal(response);
        throw new HttpError(response.status, message, code);
      }
      return assistantAgentDefinitionSchema.parse(await response.json()).name;
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<PanelOperationOutcome> {
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "DELETE" });
      return response.ok ? { kind: "success", data: {} } : { kind: "failure", ...await refusal(response) };
    },
  },
] satisfies readonly PanelServerOperation[];
