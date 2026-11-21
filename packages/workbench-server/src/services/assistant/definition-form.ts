import { z } from "zod";
import { assistantAgentInputSchema, assistantAgentPanelValuesSchema as inputSchema, type AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { PanelFormDescription, PanelFormField, PanelFormRequest } from "@ontomato/contracts/panel-projection";
import type { FormFieldError } from "@ontomato/contracts/form-fields";
import { AGENT_DEFINITION, MCP_SERVICE_OPTION, MODEL_OPTION, OBJECT_TYPE, RELATIONSHIP, SKILL, USER } from "@ontomato/contracts/panel-client-requests";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  AgentDefinitionFieldError, agentDefinitionSave, agentFormJsonSchema, parseAgentDefinitionForm, parseAgentDefinitionUpdateForm,
} from "./definition-form-schema";
import { checkedDefinition, projectAgentDefinitionSkills, readStoredAgentDefinition } from "./definitions";
import { readAssistantSkillView } from "./skills";
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
  { key: "icon", path: "/icon", schema: inputSchema.shape.icon, control: { kind: "avatar" } },
  { key: "enabled", path: "/enabled", schema: inputSchema.shape.enabled, control: { kind: "switch" } },
  { key: "systemPrompt", path: "/systemPrompt", schema: inputSchema.shape.systemPrompt, control: { kind: "markdown" } },
  { key: "modelSelection", path: "/modelSelection/modelId",
    schema: inputSchema.shape.modelSelection.removeDefault().shape.modelId, control: reference(MODEL_OPTION) },
  { key: "skills", path: "/skills", schema: inputSchema.shape.skills, control: reference(SKILL, true) },
  { key: "classNames", path: "/classNames", schema: inputSchema.shape.classNames,
    control: { kind: "reference", objectType: OBJECT_TYPE, multiple: true, relatedObjectTypes: [RELATIONSHIP] } },
  { key: "enabledMcpServiceIds", path: "/enabledMcpServiceIds", schema: inputSchema.shape.enabledMcpServiceIds, control: reference(MCP_SERVICE_OPTION, true) },
  { key: "executionUserId", path: "/executionUserId", schema: inputSchema.shape.executionUserId, control: reference(USER) },
] satisfies { key: keyof typeof initialValues; path: string; schema: z.ZodTypeAny; control: Control }[];

const fieldSchemas = fields.map(({ schema, ...field }) => ({
  ...field, valueSchema: agentFormJsonSchema(schema),
  // Reference lists may be empty even when the save body carries the array.
  required: field.key !== "modelSelection" && !schema.isOptional()
    && !(field.control.kind === "reference" && field.control.multiple && schema.safeParse([]).success),
  defaultValue: field.key === "modelSelection" ? initialValues.modelSelection.modelId : initialValues[field.key],
}));

export async function describeAgentDefinitionForm(
  request: PanelFormRequest, owner: AssistantOwner, credentials: AssistantCredentials,
): Promise<PanelFormDescription> {
  const { target, values: submittedValues, changedField } = request;
  const checkDraft = submittedValues !== undefined && changedField === null;
  let definitionRead: Promise<AssistantAgentDefinition> | undefined;
  if (target.kind === "object") {
    const { primaryKey } = target;
    if (target.objectType !== AGENT_DEFINITION || !z.string().uuid().safeParse(primaryKey).success)
      throw new HttpError(400, "Invalid agent definition target", "INVALID_REQUEST");
    definitionRead = readStoredAgentDefinition(primaryKey, owner, credentials.locale);
  }
  // The form uses the caller's capability. The user picker resolves the selected member separately.
  const [definition, openOptions, skillView] = await Promise.all([
    definitionRead,
    checkDraft ? undefined : readExecutionOptions(credentials, null),
    target.kind === "object" ? readAssistantSkillView(owner.domainId, credentials) : undefined,
  ]);
  let current = initialValues;
  if (definition) {
    const { id: _id, sortOrder: _sortOrder, ...values } = definition;
    current = values;
  }

  let values = submittedValues ?? (definition
    ? { ...current, skills: projectAgentDefinitionSkills(definition, skillView!).skills }
    : current);
  let errors: FormFieldError[] = [];
  if (checkDraft) {
    try {
      // Preserve skill selections the draft did not submit. The reader sees only their visible projection below.
      const { skills, ...stored } = current;
      const input = definition
        ? parseAgentDefinitionUpdateForm({ ...stored, ...submittedValues })
        : parseAgentDefinitionForm(submittedValues);
      const checked = await checkedDefinition(input, owner, credentials, current.executionUserId, skills,
        skillView && { credentials, view: skillView });
      values = { ...input, ...checked };
      if (definition && input.skills === undefined) {
        values.skills = projectAgentDefinitionSkills(definition, skillView!).skills;
      }
    } catch (error) {
      if (!(error instanceof AgentDefinitionFieldError)) throw error;
      errors = error.errors;
    }
  }
  const { canSetExecutionUser } = openOptions ?? await readExecutionOptions(credentials, null);
  const text = (key: string) => tForLocale(credentials.locale, `panels.agentForm.${key}`);
  return {
    values,
    errors,
    fields: fieldSchemas.map(({ key, ...field }) => {
      const readOnly = key === "executionUserId" && !canSetExecutionUser;
      return {
        ...field,
        label: text(key), readOnly, ...(readOnly ? { readOnlyReason: text("executionReadOnly") } : {}),
      };
    }),
    save: agentDefinitionSave(target),
  };
}
