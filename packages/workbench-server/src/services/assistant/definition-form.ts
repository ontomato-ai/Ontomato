import { z } from "zod";
import { assistantAgentInputSchema, assistantAgentPanelValuesSchema as inputSchema, type AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { PanelFormDescription, PanelFormField, PanelFormRequest } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SKILL, USER } from "@ontomato/contracts/panel-client-requests";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { agentDefinitionSave, agentFormJsonSchema, parseAgentDefinitionForm } from "./definition-form-schema";
import { checkedDefinition, readAgentDefinition } from "./definitions";
import { readExecutionOptions } from "./execution-setting";
import type { AssistantOwner } from "./store";

type CurrentValues = Omit<AssistantAgentDefinition, "id" | "sortOrder">;
const initialValues: CurrentValues = {
  name: "", description: "", icon: null, enabled: true, systemPrompt: "",
  ...assistantAgentInputSchema.pick({ modelSelection: true, classNames: true, enabledMcpServiceIds: true }).parse({}),
  skills: [], executionUserId: null,
};
type Control = PanelFormField["control"];
const reference = (objectType: string, multiple = false): Control => ({ kind: "reference", objectType, multiple });
const fields = [
  { key: "name", path: "/name", schema: inputSchema.shape.name, control: { kind: "text" } },
  { key: "description", path: "/description", schema: inputSchema.shape.description, control: { kind: "text", multiline: true } },
  { key: "icon", path: "/icon", schema: inputSchema.shape.icon, control: { kind: "hidden" } },
  { key: "enabled", path: "/enabled", schema: inputSchema.shape.enabled, control: { kind: "switch" } },
  { key: "systemPrompt", path: "/systemPrompt", schema: inputSchema.shape.systemPrompt, control: { kind: "markdown" } },
  { key: "modelSelection", path: "/modelSelection/modelId",
    schema: inputSchema.shape.modelSelection.removeDefault().shape.modelId, control: reference(MODEL_OPTION) },
  { key: "skills", path: "/skills", schema: inputSchema.shape.skills, control: reference(SKILL, true) },
  { key: "classNames", path: "/classNames", schema: inputSchema.shape.classNames,
    control: { kind: "reference", objectType: OBJECT_TYPE, multiple: true, relatedObjectTypes: [RELATIONSHIP] } },
  { key: "enabledMcpServiceIds", path: "/enabledMcpServiceIds", schema: inputSchema.shape.enabledMcpServiceIds, control: { kind: "hidden" } },
  { key: "executionUserId", path: "/executionUserId", schema: inputSchema.shape.executionUserId, control: reference(USER) },
] satisfies { key: keyof typeof initialValues; path: string; schema: z.ZodTypeAny; control: Control }[];

const fieldSchemas = fields.map(({ schema, ...field }) => ({
  ...field, valueSchema: agentFormJsonSchema(schema),
  required: field.key !== "modelSelection" && !schema.isOptional(),
  defaultValue: field.key === "modelSelection" ? initialValues.modelSelection.modelId : initialValues[field.key],
}));

export async function describeAgentDefinitionForm(
  request: PanelFormRequest, owner: AssistantOwner, credentials: AssistantCredentials,
): Promise<PanelFormDescription> {
  const { target } = request;
  let current = initialValues;
  if (target.kind === "object") {
    const { primaryKey } = target;
    if (target.objectType !== AGENT_DEFINITION || !z.string().uuid().safeParse(primaryKey).success)
      throw new HttpError(400, "Invalid agent definition target", "INVALID_REQUEST");
    const { id: _id, sortOrder: _sortOrder, ...values } = await readAgentDefinition(primaryKey, owner, credentials.locale);
    current = values;
  }

  let values = request.values ?? current;
  let selected = current.executionUserId;
  if (request.values !== undefined && request.changedField === null) {
    const input = parseAgentDefinitionForm(request.values);
    const checked = await checkedDefinition(input, owner, credentials, current.executionUserId);
    values = { ...input, ...checked };
    selected = checked.executionUserId;
  }
  const { canSetExecutionUser } = await readExecutionOptions(credentials, selected);
  const text = (key: string) => tForLocale(credentials.locale, `panels.agentForm.${key}`);
  return {
    values,
    fields: fieldSchemas.map(({ key, ...field }) => {
      const readOnly = key === "executionUserId" && !canSetExecutionUser;
      return { ...field, label: text(key), readOnly, ...(readOnly ? { readOnlyReason: text("executionReadOnly") } : {}) };
    }),
    save: agentDefinitionSave(target),
  };
}
