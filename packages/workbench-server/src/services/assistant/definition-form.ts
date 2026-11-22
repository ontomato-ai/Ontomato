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
/** The agent page's sections, in its order (原页面对照《智能体设置》): each field below names the one it is drawn in. */
const SECTIONS = ["basics", "model", "prompt", "capabilities", "execution", "data"] as const;
/** The sections with a line under their title, as the page had. */
const SECTION_HINTS = new Set<(typeof SECTIONS)[number]>(["model", "prompt", "capabilities", "execution", "data"]);
const fields = [
  { key: "name", path: "/name", schema: inputSchema.shape.name, control: { kind: "text" }, section: "basics", placeholder: true },
  { key: "description", path: "/description", schema: inputSchema.shape.description, control: { kind: "text", multiline: true }, section: "basics", placeholder: true },
  { key: "icon", path: "/icon", schema: inputSchema.shape.icon, control: { kind: "avatar" }, section: "basics" },
  { key: "enabled", path: "/enabled", schema: inputSchema.shape.enabled, control: { kind: "switch" }, section: "basics", help: true },
  { key: "modelSelection", path: "/modelSelection/modelId",
    schema: inputSchema.shape.modelSelection.removeDefault().shape.modelId, control: reference(MODEL_OPTION), section: "model" },
  { key: "systemPrompt", path: "/systemPrompt", schema: inputSchema.shape.systemPrompt, control: { kind: "markdown" }, section: "prompt" },
  { key: "skills", path: "/skills", schema: inputSchema.shape.skills, control: reference(SKILL, true), section: "capabilities", help: true },
  { key: "enabledMcpServiceIds", path: "/enabledMcpServiceIds", schema: inputSchema.shape.enabledMcpServiceIds,
    control: reference(MCP_SERVICE_OPTION, true), section: "capabilities", help: true },
  { key: "executionUserId", path: "/executionUserId", schema: inputSchema.shape.executionUserId, control: reference(USER), section: "execution" },
  { key: "classNames", path: "/classNames", schema: inputSchema.shape.classNames,
    control: { kind: "reference", objectType: OBJECT_TYPE, multiple: true, relatedObjectTypes: [RELATIONSHIP] }, section: "data", help: true },
] satisfies {
  key: keyof typeof initialValues; path: string; schema: z.ZodTypeAny; control: Control; section: (typeof SECTIONS)[number]; help?: true;
  placeholder?: true;
}[];

const fieldSchemas = fields.map(({ schema, help: _help, placeholder: _placeholder, ...field }) => ({
  ...field, valueSchema: agentFormJsonSchema(schema),
  // What a reader must fill in before saving, as the agent settings page always asked: the name alone. The others the
  // save body carries are given their values here and may stay as they are (原页面对照《智能体设置》, 2026-11-22).
  required: field.key === "name",
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
  const helped = new Set(fields.filter((field) => "help" in field).map(({ key }) => key));
  const suggested = new Set(fields.filter((field) => "placeholder" in field).map(({ key }) => key));
  return {
    values,
    errors,
    sections: SECTIONS.map((key) => ({
      key, title: text(`sections.${key}`), ...(SECTION_HINTS.has(key) ? { hint: text(`sections.${key}Hint`) } : {}),
    })),
    fields: fieldSchemas.map(({ key, ...field }) => {
      const readOnly = key === "executionUserId" && !canSetExecutionUser;
      return {
        ...field,
        ...(suggested.has(key) && field.control.kind === "text" ? { control: { ...field.control, placeholder: text(`placeholder.${key}`) } } : {}),
        label: text(key), readOnly, ...(readOnly ? { readOnlyReason: text("executionReadOnly") } : {}),
        ...(helped.has(key) ? { help: text(`help.${key}`) } : {}),
      };
    }),
    save: agentDefinitionSave(target),
  };
}
