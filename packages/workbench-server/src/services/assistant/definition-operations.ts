import { z } from "zod";
import { agentHostErrorSchema } from "@ontomato/contracts/agent-host";
import { assistantAgentDefinitionSchema } from "@ontomato/contracts/assistant-chat";
import { AGENT_DEFINITION, DELETE_AGENT } from "@ontomato/contracts/panel-client-requests";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { HttpError } from "../../utils/errors";
import { assertPermission } from "../../identity/installed";
import {
  agentDefinitionPermissions, createAgentDefinitionSnapshot, projectAgentDefinitionSkills, saveAgentDefinitionSnapshot,
} from "./definitions";
import type { AssistantSkillView } from "./skills";
import type { PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";
import { agentDefinitionSave, parseAgentDefinitionForm, parseAgentDefinitionUpdateForm } from "./definition-form-schema";
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
  if (target.kind === "draft" || submittedFields?.includes("/skills")) return parseAgentDefinitionForm(values);
  if (submittedFields === undefined) return parseAgentDefinitionUpdateForm(values);
  const { skills: _skills, ...otherValues } = values;
  return parseAgentDefinitionUpdateForm(otherValues);
}

async function ownerError(response: Response) {
  return agentHostErrorSchema.parse(await response.json()).error;
}

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
      const selection = { credentials: host.initiator.credentials, view: host.skillView };
      try {
        await assertPermission(credentials, agentDefinitionPermissions);
        const saved = target.kind === "draft"
          ? await createAgentDefinitionSnapshot(intentId, parseAgentDefinitionForm(inputSchema.parse(input).values), owner, credentials, selection)
          : await saveAgentDefinitionSnapshot(target.primaryKey, draftInput(input, target), owner, credentials, selection);
        return { kind: "success", data: saved.definition, affected: affectedDefinition(saved.definition.id) };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "INVALID_REQUEST", message: error.message };
      }
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
    async targetLabel(host: PanelOperationHost, target: PanelRecordTarget) {
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "GET" });
      if (!response.ok) {
        const { code, message } = await ownerError(response);
        throw new HttpError(response.status, message, code);
      }
      return assistantAgentDefinitionSchema.parse(await response.json()).name;
    },
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "DELETE" });
      return response.ok
        ? { kind: "success", data: {}, affected: affectedDefinition(target.primaryKey) }
        : { kind: response.status >= 500 ? "failure" : "refusal", ...await ownerError(response) };
    },
  },
] satisfies readonly PanelServerOperation[];
