import { z } from "zod";
import { agentHostErrorSchema } from "@ontomato/contracts/agent-host";
import { assistantAgentDefinitionSchema } from "@ontomato/contracts/assistant-chat";
import { formFieldErrorSchema } from "@ontomato/contracts/form-fields";
import { AGENT_DEFINITION, DELETE_AGENT } from "@ontomato/contracts/panel-client-requests";
import { assistantService } from "../assistant/service";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { changeProductDomainGrantRequestSchema, changeProductGrantRequestSchema } from "@ontomato/contracts/product-governance";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { productGrantAllowed, requireProductGrant, setProductGrants, shareProductResource } from "../product-governance/grants";
import {
  agentDefinitionDeletionRestriction, createAgentDefinitionSnapshot, projectAgentDefinitionSkills, readStoredAgentDefinition, saveAgentDefinitionSnapshot,
} from "../assistant/definitions";
import type { AssistantSkillView } from "../assistant/skills";
import type { PanelImpactInspector, PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome } from "./server-operations";
import { AgentDefinitionFieldError, agentDefinitionSave, parseAgentDefinitionForm, parseAgentDefinitionUpdateForm } from "../assistant/definition-form-schema";
import { modelSelectionWrite } from "../assistant/model-panel-form";
import { createSystemAgentOwners, systemFormValues } from "./agent-definition-directory";

const resultSchema = z.union([assistantAgentDefinitionSchema, modelSelectionWrite]);
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
  const system = systemFormValues.safeParse(values);
  if (system.success) return { modelSelection: system.data.modelSelection };
  if (submittedFields === undefined) return parseAgentDefinitionUpdateForm(values);
  if (submittedFields.some(field => field === "/skills" || field.startsWith("/skills/"))) return values;
  const { skills: _skills, ...otherValues } = values;
  return otherValues;
}

function parseSystemModelSelection(values: unknown) {
  const parsed = systemFormValues.safeParse(values);
  if (!parsed.success) throw new HttpError(400, "Invalid system agent model selection", "INVALID_REQUEST");
  return parsed.data.modelSelection;
}

async function unsuccessfulWrite(response: Response): Promise<SinglePanelOperationOutcome> {
  const { error, errors } = agentHostErrorSchema.extend({
    errors: z.array(formFieldErrorSchema).optional(),
  }).parse(await response.json());
  if (response.status >= 500) return { kind: "failure", ...error };
  return { kind: "refusal", ...error, ...(errors && { errors }) };
}

async function definitionLabel(host: PanelOperationHost, target: PanelRecordTarget) {
  const { owner, credentials } = host.initiator;
  const source = await createSystemAgentOwners(owner, credentials).forTarget(target.primaryKey);
  if (source) {
    await requireProductGrant(target.primaryKey, "view", credentials);
    return (await source.read()).name;
  }
  const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "GET" });
  if (!response.ok) {
    const { error } = agentHostErrorSchema.parse(await response.json());
    throw new HttpError(response.status, error.message, error.code);
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

async function systemDeletionRestriction(host: PanelOperationHost, target: PanelRecordTarget) {
  const { owner, credentials } = host.initiator;
  if (await createSystemAgentOwners(owner, credentials).forTarget(target.primaryKey))
    return { reason: tForLocale(host.locale, "panels.agentDefinition.systemCannotDelete") };
}

const grantInput = changeProductGrantRequestSchema.omit({ remove: true });
const grantLevels = {
  use: ["use"],
  view: ["use", "view"],
  edit: ["use", "view", "edit"],
} as const;

function grantOperation<Input extends Record<string, unknown>>(
  name: "grant" | "revoke" | "share",
  schema: z.ZodType<Input>,
  mutate: (id: string, credentials: PanelOperationHost["executor"]["credentials"], input: Input) => Promise<unknown>,
) {
  const handlerRef = `agents.${name}`;
  return {
    handlerRef,
    binding: { kind: "PlatformOperation", id: handlerRef },
    labelKey: `panels.agentDefinition.${name}`,
    kind: "action",
    effect: "write",
    batch: false,
    targetType: AGENT_DEFINITION,
    targetSchema,
    targetInput: "agent",
    targetLabel: definitionLabel,
    inputSchema: schema,
    resultSchema: emptyResultSchema,
    async execute({ executor }, target, input) {
      const { primaryKey } = targetSchema.parse(target);
      const values = schema.parse(input);
      const { owner, credentials } = executor;
      try {
        await requireProductGrant(primaryKey, "edit", credentials);
        if (!await createSystemAgentOwners(owner, credentials).forTarget(primaryKey))
          await readStoredAgentDefinition(primaryKey, owner, credentials.locale);
        await mutate(primaryKey, credentials, values);
        return { kind: "success", data: {}, affected: affectedDefinition(primaryKey) };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "PRODUCT_WRITE_REFUSED", message: error.message };
      }
    },
  } satisfies PanelServerOperation;
}

export const agentDefinitionOperations = [
  {
    handlerRef: `${AGENT_DEFINITION}.save`,
    labelKey: "panels.agentDefinition.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: AGENT_DEFINITION },
    effect: "write",
    batch: false,
    targetType: AGENT_DEFINITION,
    targetSchema: z.discriminatedUnion("kind", [targetSchema, panelFormTargetSchema.options[1]]),
    inputSchema,
    resultSchema,
    draftInput,

    projectResult(data: unknown, view: AssistantSkillView) {
      const saved = resultSchema.parse(data);
      return "id" in saved ? projectAgentDefinitionSkills(saved, view) : saved;
    },
    create: true,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, intentId: string): Promise<SinglePanelOperationOutcome> {
      const { owner, credentials } = host.executor;
      const { values, submittedFields } = inputSchema.parse(input);
      try {
        if (target.kind === "object") {
          const caller = host.initiator;
          const source = await createSystemAgentOwners(caller.owner, caller.credentials).forTarget(target.primaryKey);
          if (source) {
            await requireProductGrant(target.primaryKey, "edit", caller.credentials);
            if (submittedFields?.some(path => path !== "/modelSelection" && path !== "/modelSelection/modelId"))
              throw new HttpError(400, "Only the model selection can be changed", "INVALID_REQUEST");
            const data = submittedFields?.length === 0
              ? { modelSelection: (await source.read()).modelSelection }
              : await source.save(target.primaryKey, parseSystemModelSelection(values));
            return { kind: "success", data, affected: affectedDefinition(target.primaryKey) };
          }
        }
        const selection = { credentials: host.initiator.credentials, view: host.skillView! };
        const saved = target.kind === "draft"
          ? await createAgentDefinitionSnapshot(intentId, parseAgentDefinitionForm(values), owner, credentials, selection)
          : await saveAgentDefinitionSnapshot(target.primaryKey,
            submittedFields === undefined ? parseAgentDefinitionUpdateForm(values) : { values, submittedFields },
            owner, credentials, selection);
        return {
          kind: "success", data: saved.definition,
          ...(target.kind === "draft" && { created: { objectType: AGENT_DEFINITION, primaryKey: saved.definition.id } }),
          affected: affectedDefinition(saved.definition.id),
        };
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
    done: (host, name) => tForLocale(host.locale, "panels.agentDefinition.deleted", { name }),
    inspectImpact: deleteImpact,
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget) {
      if (!await productGrantAllowed(target.primaryKey, "edit", host.initiator.credentials))
        return { reason: tForLocale(host.locale, "panels.agentForm.editReadOnly") };
      const restriction = await systemDeletionRestriction(host, target);
      return restriction ?? agentDefinitionDeletionRestriction(target.primaryKey, host.initiator.owner, host.locale);
    },
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const restriction = await systemDeletionRestriction(host, target);
      if (restriction) return { kind: "refusal", code: "SYSTEM_AGENT_READ_ONLY", message: restriction.reason };
      const response = await host.requestWorkbench(agentDefinitionSave(target).path, { method: "DELETE" });
      return response.ok
        ? { kind: "success", data: {}, affected: { ...affectedDefinition(target.primaryKey), removed: affectedDefinition(target.primaryKey).objects } }
        : unsuccessfulWrite(response);
    },
  },
  grantOperation("grant", grantInput, (id, credentials, { verb, ...principal }) =>
    setProductGrants(credentials, { id, ...principal, verbs: [...grantLevels[verb]] })),
  grantOperation("revoke", grantInput.omit({ verb: true }), (id, credentials, principal) =>
    setProductGrants(credentials, { id, ...principal, verbs: [] })),
  grantOperation("share", changeProductDomainGrantRequestSchema, (id, credentials, { shared }) =>
    shareProductResource(id, shared, credentials)),
] as const satisfies readonly PanelServerOperation[];
