import { z } from "zod";
import { modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { BUILDER_AGENT } from "@ontomato/contracts/platform-object-types";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormField, type PanelFormRequest, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  buildModelSelectOptions, describeModelPanelForm, DOMAIN_DEFAULT_MODEL_OPTION, formJsonSchema,
  modelPanelValues, modelSelectionWrite, readDomainModelLabelMap, readDomainModelOptions,
} from "../assistant/model-panel-form";
import type { AssistantOwner } from "../assistant/store";
import { affected } from "../product-panels/data-query-operations";
import type { PanelOperationTarget, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";
import { assertAppBuilderAccess } from "./access";
import { builderAgentName, createBuilderAgent, listBuilderAgents, readBuilderAgent, saveBuilderModel } from "./agents";
import { APP_BUILDER } from "./definition";

export const BUILDER_MODELS_FORM_KEY = "all";
const operation = `${BUILDER_AGENT}.save`;
const createValues = z.object({ name: builderAgentName }).strict();
const saveInput = panelFormSaveInputSchema.omit({ revision: true }).strict();
const id = z.string().uuid();
const modelChoiceSchema = z.union([z.literal(DOMAIN_DEFAULT_MODEL_OPTION), modelReferenceSchema]);
const batchModelsPatch = z.record(id, z.union([modelChoiceSchema, z.null()]));
const result = z.union([
  z.object({ id, modelSelection: modelPanelValues }).strict(),
  z.object({ id: z.literal(BUILDER_MODELS_FORM_KEY), models: z.record(id, modelChoiceSchema) }).strict(),
]);
const agentsPath = "/api/app-builder/agents";

function createBody(values: unknown) {
  return { ...createValues.parse(values), modelSelection: { modelId: null } };
}

function toStoredModelId(choice: string | null): string | null {
  return choice === null || choice === DOMAIN_DEFAULT_MODEL_OPTION ? null : choice;
}

function toFormModelChoice(modelId: string | null): string {
  return modelId ?? DOMAIN_DEFAULT_MODEL_OPTION;
}

function submittedBatchValues(input: unknown) {
  const { values, submittedFields } = saveInput.parse(input);
  const raw = batchModelsPatch.parse(values);
  if (submittedFields === undefined) return raw;
  const submittedIds = new Set(submittedFields.map(path => path.replace(/^\//, "")));
  return Object.fromEntries(Object.entries(raw).filter(([agentId]) => submittedIds.has(agentId)));
}

export function createBuilderModelReads(owner: AssistantOwner, viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  const nameLabel = tForLocale(viewer.locale, "panels.agentForm.name");
  const loadModelLabels = () => readDomainModelLabelMap(viewer);
  function displayName(rawName: string): string {
    return rawName === APP_BUILDER.name ? text("defaultBuilderAgentName") : rawName;
  }
  function toRecord(agent: Awaited<ReturnType<typeof readBuilderAgent>>, modelLabels: Map<string | null, string>): PanelRecord {
    const label = displayName(agent.name);
    const modelId = agent.modelSelection.modelId;
    return {
      primaryKey: agent.id, label, subtitle: text("builderDescription"),
      fields: {
        name: label,
        modelId: modelLabels.get(modelId) ?? modelId ?? tForLocale(viewer.locale, "panels.agentOptions.domainDefault"),
      },
      fieldLabels: { name: nameLabel, modelId: tForLocale(viewer.locale, "panels.agentForm.modelSelection") },
    };
  }
  async function describeBatchForm(inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
    const [agents, domainOptions] = await Promise.all([listBuilderAgents(owner), readDomainModelOptions(viewer)]);
    const validRefs = new Set(domainOptions.map(option => (option.value === null ? DOMAIN_DEFAULT_MODEL_OPTION : String(option.value))));
    const stored: Record<string, string> = Object.fromEntries(
      agents.map(agent => [agent.id, toFormModelChoice(agent.modelSelection.modelId)]),
    );
    const values: Record<string, unknown> = { ...stored };
    const errors: PanelFormDescription["errors"] = [];
    if (inputs.values) {
      for (const agent of agents) {
        if (!Object.hasOwn(inputs.values, agent.id)) continue;
        const incoming = inputs.values[agent.id];
        const normalized = incoming === null ? DOMAIN_DEFAULT_MODEL_OPTION : incoming;
        values[agent.id] = normalized;
        if (normalized !== stored[agent.id] && (typeof normalized !== "string" || !validRefs.has(normalized))) {
          errors.push({ field: `/${agent.id}`, code: "invalid_option", message: text("invalidModel") });
        }
      }
    }
    const fields: PanelFormField[] = agents.map(agent => ({
      path: `/${agent.id}`,
      label: displayName(agent.name),
      help: text("builderDescription"),
      valueSchema: formJsonSchema(modelChoiceSchema),
      required: true,
      readOnly: false,
      defaultValue: DOMAIN_DEFAULT_MODEL_OPTION,
      control: {
        kind: "select",
        options: buildModelSelectOptions(domainOptions, agent.modelSelection.modelId, viewer.locale),
      },
    }));
    return {
      fields,
      values: values as PanelFormDescription["values"],
      errors,
      save: {
        method: "PUT",
        path: `${agentsPath}/models`,
        bodySchema: formJsonSchema(batchModelsPatch),
        draftOperation: operation,
      },
    };
  }
  return {
    async list() {
      await assertAppBuilderAccess(viewer);
      const [agents, modelLabels] = await Promise.all([listBuilderAgents(owner), loadModelLabels()]);
      return agents.map(agent => toRecord(agent, modelLabels));
    },
    async record(primaryKey: string) {
      await assertAppBuilderAccess(viewer);
      if (primaryKey === BUILDER_MODELS_FORM_KEY) {
        const agents = await listBuilderAgents(owner);
        return {
          primaryKey: BUILDER_MODELS_FORM_KEY,
          label: text("defaultBuilderAgentName"),
          subtitle: text("builderDescription"),
          fields: { count: String(agents.length) },
        };
      }
      const [agent, modelLabels] = await Promise.all([readBuilderAgent(owner, id.parse(primaryKey)), loadModelLabels()]);
      return toRecord(agent, modelLabels);
    },
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">) {
      await assertAppBuilderAccess(viewer);
      if (primaryKey === BUILDER_MODELS_FORM_KEY) return describeBatchForm(inputs);
      const agent = await readBuilderAgent(owner, id.parse(primaryKey));
      return describeModelPanelForm(owner.domainId, agent.modelSelection.modelId, inputs, {
        method: "PUT", path: `${agentsPath}/${primaryKey}/model`, draftOperation: operation,
      }, viewer.locale, {
        label: displayName(agent.name),
        help: text("builderDescription"),
      });
    },
    async createForm(inputs: Pick<PanelFormRequest, "values">): Promise<PanelFormDescription> {
      await assertAppBuilderAccess(viewer);
      const values = inputs.values ?? { name: "" };
      const errors = inputs.values && !createValues.safeParse(values).success
        ? [{ field: "/name", code: "invalid_format" as const, message: text("invalidBuilderName") }] : [];
      return {
        values, errors,
        fields: [{
          path: "/name", label: nameLabel, valueSchema: formJsonSchema(builderAgentName),
          required: true, readOnly: false, control: { kind: "text", maxLength: 200 },
        }],
        save: { method: "POST", path: agentsPath, bodySchema: formJsonSchema(createValues), draftOperation: operation },
      };
    },
  };
}

async function saveBuilderModelsBatch(
  owner: AssistantOwner, locale: string | undefined, input: unknown,
): Promise<SinglePanelOperationOutcome> {
  const changes = submittedBatchValues(input);
  const agents = await listBuilderAgents(owner);
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const updated: Record<string, string> = Object.fromEntries(
    agents.map(agent => [agent.id, toFormModelChoice(agent.modelSelection.modelId)]),
  );
  const savedFields: Record<string, string> = {};
  const errors: { field: string; code: "invalid_option" | "target_unavailable"; message: string }[] = [];
  let hasFailure = false;
  const batchAffected = affected(BUILDER_AGENT, BUILDER_MODELS_FORM_KEY, [BUILDER_AGENT]);

  for (const [agentId, rawChoice] of Object.entries(changes)) {
    const existing = byId.get(agentId);
    const nextModelId = toStoredModelId(rawChoice);
    const normalizedChoice = toFormModelChoice(nextModelId);
    if (!existing) {
      errors.push({ field: `/${agentId}`, code: "target_unavailable", message: "App builder unavailable" });
      continue;
    }
    if (existing.modelSelection.modelId === nextModelId) continue;
    try {
      await saveBuilderModel(owner, agentId, { modelId: nextModelId });
      savedFields[`/${agentId}`] = normalizedChoice;
      updated[agentId] = normalizedChoice;
    } catch (error) {
      if (error instanceof HttpError && error.status === 400) {
        errors.push({ field: `/${agentId}`, code: "invalid_option", message: tForLocale(locale, "panels.simplePages.invalidModel") });
      } else if (error instanceof HttpError && (error.status === 404 || error.status === 403)) {
        errors.push({ field: `/${agentId}`, code: "target_unavailable", message: error.message });
      } else {
        hasFailure = true;
        errors.push({
          field: `/${agentId}`,
          code: "target_unavailable",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (errors.length > 0) {
    return {
      kind: hasFailure ? "failure" : "refusal",
      code: "BUILDER_MODELS_SAVE_FAILED",
      message: errors[0]!.message,
      errors,
      ...(Object.keys(savedFields).length > 0 && { savedFields, affected: batchAffected }),
    };
  }
  return { kind: "success", data: { id: BUILDER_MODELS_FORM_KEY, models: updated }, affected: batchAffected };
}

export const builderModelOperations = [{
  handlerRef: operation, labelKey: "panels.simplePages.saveBuilder",
  kind: "form.save", effect: "write", batch: false,
  binding: { kind: "PlatformObjectType", id: BUILDER_AGENT }, targetType: BUILDER_AGENT,
  targetSchema: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("object"),
      objectType: z.literal(BUILDER_AGENT),
      primaryKey: z.union([id, z.literal(BUILDER_MODELS_FORM_KEY)]),
    }).strict(),
    panelFormTargetSchema.options[1],
  ]),
  inputSchema: saveInput, resultSchema: result,
  draftOperation: () => operation,
  draftInput(input, target: PanelOperationTarget) {
    if (target.kind === "draft") return createValues.parse(saveInput.parse(input).values);
    if (target.primaryKey === BUILDER_MODELS_FORM_KEY) return submittedBatchValues(input);
    return modelSelectionWrite.parse(saveInput.parse(input).values);
  },
  formInstructions: "For a new builder agent, submit its name; it starts on the domain default model. For the domain form ('all'), submit only changed agent IDs to a chat model reference or '@default'. For a single agent, select a chat model or null to return to the domain default.",
  create: {
    draftValues: values => createValues.parse(values),
    createdObject: data => ({ objectType: BUILDER_AGENT, primaryKey: result.parse(data).id }),
  },
  async execute(host, target, input, intentId) {
    const { owner, credentials } = host.executor;
    await assertAppBuilderAccess(credentials);
    if (target.kind === "object" && target.primaryKey === BUILDER_MODELS_FORM_KEY) {
      return saveBuilderModelsBatch(owner, host.locale, input);
    }
    const { values } = saveInput.parse(input);
    try {
      const data = target.kind === "draft"
        ? { ...await createBuilderAgent(owner, createBody(values), intentId), modelSelection: { modelId: null } }
        : { id: target.primaryKey, ...await saveBuilderModel(owner, target.primaryKey, modelSelectionWrite.parse(values).modelSelection) };
      return { kind: "success", data, affected: affected(BUILDER_AGENT, data.id, [BUILDER_AGENT]) };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 400) throw error;
      const message = tForLocale(host.locale, "panels.simplePages.invalidModel");
      return { kind: "refusal", code: "INVALID_MODEL", message, errors: [{ field: "/modelSelection/modelId", code: "invalid_option" as const, message }] };
    }
  },
}] satisfies readonly PanelServerOperation[];
