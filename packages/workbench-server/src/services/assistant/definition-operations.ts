import { z } from "zod";
import { agentHostErrorSchema } from "@ontomato/contracts/agent-host";
import { assistantAgentDefinitionSchema } from "@ontomato/contracts/assistant-chat";
import { formFieldErrorSchema } from "@ontomato/contracts/form-fields";
import { AGENT_DEFINITION, DELETE_AGENT } from "@ontomato/contracts/panel-client-requests";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { assertPermission } from "../../identity/installed";
import {
  agentDefinitionPermissions, createAgentDefinitionSnapshot, projectAgentDefinitionSkills, saveAgentDefinitionSnapshot,
} from "./definitions";
import type { AssistantSkillView } from "./skills";
import type { PanelImpactInspector, PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";
import { AgentDefinitionFieldError, agentDefinitionSave, parseAgentDefinitionForm, parseAgentDefinitionUpdateForm } from "./definition-form-schema";
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

function draftInput(input: Record<string, unknown>, target: PanelOperationTarget) {
  const { values, submittedFields } = inputSchema.parse(input);
  if (target.kind === "draft") return parseAgentDefinitionForm(values);
  if (submittedFields === undefined) return parseAgentDefinitionUpdateForm(values);
  if (submittedFields.some(field => field === "/skills" || field.startsWith("/skills/"))) return values;
  const { skills: _skills, ...otherValues } = values;
  return otherValues;
}

async function ownerError(response: Response) {
  return agentHostErrorSchema.parse(await response.json()).error;
}

async function unsuccessfulWrite(response: Response): Promise<SinglePanelOperationOutcome> {
  const { error, errors } = agentHostErrorSchema.extend({
    errors: z.array(formFieldErrorSchema).optional(),
  }).parse(await response.json());
  if (response.status >= 500) return { kind: "failure", ...error };
  return { kind: "refusal", ...error, ...(errors && { errors }) };
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
      total: 1,
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
    draftInput,
    formInstructions: "Read the definition form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. When editing, omit skills unless the selection is explicitly changing.",
    projectResult(data: unknown, view: AssistantSkillView) {
      return projectAgentDefinitionSkills(assistantAgentDefinitionSchema.parse(data), view);
    },
    create: {
      draftValues(values: unknown, domainId: string) {
        const input = parseAgentDefinitionForm(values);
        return { ...input, skills: resolveAssistantSkillReferences(input.skills, domainId), executionUserId: input.executionUserId ?? null };
      },
      createdObject: (data: unknown) => ({ objectType: AGENT_DEFINITION, primaryKey: assistantAgentDefinitionSchema.parse(data).id }),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome> {
      const { owner, credentials } = host.executor;
      const selection = { credentials: host.initiator.credentials, view: host.skillView! };
      try {
        await assertPermission(credentials, agentDefinitionPermissions);
        const { values, submittedFields } = inputSchema.parse(input);
        const saved = target.kind === "draft"
          ? await createAgentDefinitionSnapshot(intentId, parseAgentDefinitionForm(values), owner, credentials, selection)
          : await saveAgentDefinitionSnapshot(target.primaryKey,
            submittedFields === undefined ? parseAgentDefinitionUpdateForm(values) : { values, submittedFields },
            owner, credentials, selection);
        return { kind: "success", data: saved.definition, affected: affectedDefinition(saved.definition.id) };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "INVALID_REQUEST", message: error.message,
          ...(error instanceof AgentDefinitionFieldError && { errors: error.errors }) };
      }
    },
  },
  {
    handlerRef: DELETE_AGENT,
    labelKey: "panels.agentDefinition.delete",
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
