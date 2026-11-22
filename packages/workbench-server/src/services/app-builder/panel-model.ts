import { z } from "zod";
import { BUILDER_AGENT } from "@ontomato/contracts/platform-object-types";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormRequest, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { describeModelPanelForm, formJsonSchema, modelPanelValues, modelSelectionWrite } from "../assistant/model-panel-form";
import type { AssistantOwner } from "../assistant/store";
import { affected } from "../product-panels/data-query-operations";
import type { PanelOperationTarget, PanelServerOperation } from "../product-panels/server-operations";
import { assertAppBuilderAccess } from "./access";
import { builderAgentName, createBuilderAgent, listBuilderAgents, readBuilderAgent, saveBuilderModel } from "./agents";

const operation = `${BUILDER_AGENT}.save`;
const createValues = z.object({ name: builderAgentName }).strict();
const saveInput = panelFormSaveInputSchema.omit({ revision: true }).strict();
const id = z.string().uuid();
const result = z.object({ id, modelSelection: modelPanelValues }).strict();
const agentsPath = "/api/app-builder/agents";

function createBody(values: unknown) {
  return { ...createValues.parse(values), modelSelection: { modelId: null } };
}

export function createBuilderModelReads(owner: AssistantOwner, viewer: AssistantCredentials) {
  const text = (key: string) => tForLocale(viewer.locale, `panels.simplePages.${key}`);
  const nameLabel = tForLocale(viewer.locale, "panels.agentForm.name");
  function toRecord(agent: Awaited<ReturnType<typeof readBuilderAgent>>): PanelRecord {
    return {
      primaryKey: agent.id, label: agent.name, subtitle: text("builderDescription"),
      fields: {
        name: agent.name,
        modelId: agent.modelSelection.modelId ?? tForLocale(viewer.locale, "panels.agentOptions.domainDefault"),
      },
      fieldLabels: { name: nameLabel, modelId: tForLocale(viewer.locale, "panels.agentForm.modelSelection") },
    };
  }
  return {
    async list() {
      await assertAppBuilderAccess(viewer);
      return (await listBuilderAgents(owner)).map(toRecord);
    },
    async record(primaryKey: string) {
      await assertAppBuilderAccess(viewer);
      return toRecord(await readBuilderAgent(owner, id.parse(primaryKey)));
    },
    async form(primaryKey: string, inputs: Pick<PanelFormRequest, "values">) {
      await assertAppBuilderAccess(viewer);
      const { modelSelection } = await readBuilderAgent(owner, id.parse(primaryKey));
      return describeModelPanelForm(owner.domainId, modelSelection.modelId, inputs, {
        method: "PUT", path: `${agentsPath}/${primaryKey}/model`, draftOperation: operation,
      }, viewer.locale);
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

export const builderModelOperations = [{
  handlerRef: operation, labelKey: "panels.simplePages.saveBuilder",
  kind: "form.save", effect: "write", batch: false,
  binding: { kind: "PlatformObjectType", id: BUILDER_AGENT }, targetType: BUILDER_AGENT,
  targetSchema: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("object"), objectType: z.literal(BUILDER_AGENT), primaryKey: id }).strict(),
    panelFormTargetSchema.options[1],
  ]),
  inputSchema: saveInput, resultSchema: result,
  draftOperation: () => operation,
  draftInput(input, target: PanelOperationTarget) {
    const { values } = saveInput.parse(input);
    return target.kind === "draft" ? createValues.parse(values) : modelSelectionWrite.parse(values);
  },
  formInstructions: "For a new builder agent, submit its name; it starts on the domain default model. For an existing agent, select a chat model or return to the domain default with null.",
  create: {
    draftValues: values => createValues.parse(values),
    createdObject: data => ({ objectType: BUILDER_AGENT, primaryKey: result.parse(data).id }),
  },
  async execute(host, target, input, intentId) {
    const { owner, credentials } = host.executor;
    await assertAppBuilderAccess(credentials);
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
