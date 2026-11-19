import { z } from "zod";
import { agentHostErrorSchema } from "@ontomato/contracts/agent-host";
import { assistantAgentDefinitionSchema } from "@ontomato/contracts/assistant-chat";
import { AGENT_DEFINITION, DELETE_AGENT } from "@ontomato/contracts/panel-client-requests";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type { PanelImpactInspector, PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";
import { agentDefinitionSave, parseAgentDefinitionForm } from "./definition-form-schema";
import { resolveAssistantSkillReferences } from "./skill-references";

const targetSchema = panelFormTargetSchema.options[0].extend({
  objectType: z.literal(AGENT_DEFINITION),
  primaryKey: z.string().uuid(),
}).strict();
const inputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const emptyResultSchema = z.object({}).strict();
const affectedDefinition = (id: string) => ({
  objects: [{ objectType: AGENT_DEFINITION, primaryKey: id }],
  objectTypes: [AGENT_DEFINITION],
});

async function ownerError(response: Response) {
  return agentHostErrorSchema.parse(await response.json()).error;
}

async function unsuccessfulWrite(response: Response): Promise<SinglePanelOperationOutcome> {
  return { kind: response.status >= 500 ? "failure" : "refusal", ...await ownerError(response) };
}

async function definitionLabel(host: PanelOperationHost, target: PanelRecordTarget) {
  const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "GET" });
  if (!response.ok) {
    const { code, message } = await ownerError(response);
    throw new HttpError(response.status, message, code);
  }
  return assistantAgentDefinitionSchema.parse(await response.json()).name;
}

const deleteImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_AGENT}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const { objectType, primaryKey } = target;
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteAgentImpact"),
      objects: [{ target: { objectType, primaryKey }, label: await definitionLabel(host, target) }],
    };
  },
};

export const agentDefinitionOperations = [
  {
    handlerRef: `${AGENT_DEFINITION}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: AGENT_DEFINITION },
    effect: "write",
    batch: false,
    targetType: AGENT_DEFINITION,
    targetSchema: z.discriminatedUnion("kind", [targetSchema, panelFormTargetSchema.options[1]]),
    inputSchema,
    resultSchema: assistantAgentDefinitionSchema,
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
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome> {
      const save = agentDefinitionSave(target);
      const response = await host.requestWorkbench(save.path, {
        method: save.method,
        headers: save.method === "POST" ? { "Idempotency-Key": intentId } : {},
        body: JSON.stringify(parseAgentDefinitionForm(inputSchema.parse(input).values)),
      });
      if (!response.ok) return unsuccessfulWrite(response);
      const data = assistantAgentDefinitionSchema.parse(await response.json());
      return { kind: "success", data, affected: affectedDefinition(data.id) };
    },
  },
  {
    handlerRef: DELETE_AGENT,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_AGENT },
    effect: "write",
    batch: false,
    targetType: AGENT_DEFINITION,
    targetSchema,
    inputSchema: z.object({}).strict(),
    resultSchema: emptyResultSchema,
    targetInput: "agent",
    targetLabel: definitionLabel,
    inspectImpact: deleteImpact,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "DELETE" });
      return response.ok
        ? { kind: "success", data: {}, affected: affectedDefinition(target.primaryKey) }
        : unsuccessfulWrite(response);
    },
  },
] satisfies readonly PanelServerOperation[];
