import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormDescription, PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema as jsonSchema } from "../../utils/zod-json-schema";

export const scopeKinds = ["all", "self_organization", "self_subtree", "self_descendants", "initiated_by_self", "assigned_to_self"] as const;
const policyModes = ["none", "rule", "agent"] as const;
const invocationChoices = ["manual", "automatic", "fixed"] as const;
const contractFields = [
  "className", "idField", "stepField", "statusField", "orgField", "initiatorField", "assigneeField", "workflowRefField",
] as const;
const policyObjectFields = ["parameters", "parameterBindings", "valueMap"] as const;

const text = z.string();
const optionalText = text.nullish();
const scope = z.enum(scopeKinds);
const invocationChoice = z.enum(invocationChoices);
const policyMode = z.enum(policyModes);
const statusOpen = z.array(text);
const actorPolicySchema = z.object({
  mode: policyMode.nullish(),
  metricViewId: optionalText,
  metricRevision: optionalText,
  principalField: optionalText,
  executionPrincipalId: optionalText,
  agentId: optionalText,
  instruction: optionalText,
}).passthrough();

const storedStepSchema = z.object({
  stepNo: z.number().int().positive().nullish(),
  name: optionalText,
  roleCode: optionalText,
  actionId: optionalText,
  scope: scope.nullish(),
  caseScoped: z.boolean().nullish(),
  actionType: optionalText,
  invocationMode: z.enum(["manual", "automatic"]).nullish(),
  actorPolicy: actorPolicySchema.nullish(),
}).passthrough();

const formStepSchema = storedStepSchema.omit({ actionType: true, invocationMode: true }).extend({
  invocationChoice: invocationChoice.default("manual"),
});

const contractSchema = z.object({
  ...Object.fromEntries(contractFields.map(name => [name, optionalText])),
  className: optionalText,
  statusOpen: statusOpen.nullish(),
}).passthrough();

const definitionSchema = z.object({
  name: text,
  description: optionalText,
  runClassName: optionalText,
  runContract: contractSchema.nullish(),
  temporary: z.boolean().nullish(),
  caseFormSchema: runtimeJsonObjectSchema.nullish(),
});

export const workflowSchema = definitionSchema.extend({
  id: text.min(1),
  status: optionalText,
  version: z.number().nullish(),
  hasDraft: z.boolean().nullish(),
  createdBy: optionalText,
  reviewedBy: optionalText,
  steps: z.array(storedStepSchema).nullish(),
});

export const workflowValuesSchema = definitionSchema.extend({
  id: text.min(1).optional(),
  name: text.trim().min(1),
  steps: z.array(formStepSchema).default([]),
});

export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowStep = z.infer<typeof storedStepSchema>;
type FormStep = z.infer<typeof formStepSchema>;
type Translate = (key: string, params?: Record<string, string | number>) => string;
type Option = { value: string; label: string };

const blankStep = {
  name: "", roleCode: "", actionId: "", scope: "all", invocationChoice: "manual",
  caseScoped: false, actorPolicy: { mode: "none" },
} satisfies PanelFormValues;

export function workflowText(locale?: string): Translate {
  return (key, params) => tForLocale(locale, `panels.workflow.${key}`, params);
}

export function requireWorkflow(workflow: Workflow | null | undefined, locale?: string): Workflow {
  if (!workflow) throw new HttpError(404, workflowText(locale)("notFound"), "WORKFLOW_NOT_FOUND");
  return workflow;
}

export const canDeactivateWorkflow = (workflow: Workflow) => workflow.status === "ACTIVE";
export const canActivateWorkflow = (workflow: Workflow) => !canDeactivateWorkflow(workflow) || Boolean(workflow.hasDraft);

export function stepInvocation(step: WorkflowStep) {
  return step.actionType === "execute" ? "fixed" : step.invocationMode ?? "manual";
}

export function workflowFormValues(workflow: Workflow): PanelFormValues {
  const { id, name, description, runClassName, runContract, temporary, caseFormSchema, steps } = workflow;
  return runtimeJsonObjectSchema.parse({
    id,
    name,
    description: description ?? "",
    runClassName: runClassName ?? null,
    runContract: runContract ? { ...runContract, statusOpen: runContract.statusOpen ?? [] } : null,
    temporary: temporary ?? null,
    caseFormSchema: caseFormSchema ?? null,
    steps: (steps ?? []).map(({ actionType, invocationMode, ...step }) => {
      const policy = step.actorPolicy;
      const mode = policy?.mode ?? "none";
      return {
        ...step,
        invocationChoice: stepInvocation({ actionType, invocationMode }),
        caseScoped: step.caseScoped === true,
        actorPolicy: {
          ...policy,
          mode,
          ...(mode === "rule" && Object.fromEntries(policyObjectFields.map(name => [name, policy?.[name] ?? {}]))),
        },
      };
    }),
  });
}

function savedPolicy(policy: FormStep["actorPolicy"]) {
  switch (policy?.mode) {
    case "rule":
      return {
        mode: policy.mode,
        metricViewId: policy.metricViewId?.trim(),
        metricRevision: policy.metricRevision?.trim(),
        principalField: policy.principalField?.trim() || "principal",
        executionPrincipalId: policy.executionPrincipalId?.trim() || undefined,
        ...Object.fromEntries(policyObjectFields.map(name => [name, runtimeJsonObjectSchema.parse(policy[name] ?? {})])),
      };
    case "agent":
      return {
        mode: policy.mode,
        executionPrincipalId: policy.executionPrincipalId?.trim() || undefined,
        agentId: policy.agentId?.trim(),
        instruction: policy.instruction?.trim(),
      };
    default:
      return { mode: "none" };
  }
}

export function workflowSaveValues(input: Record<string, unknown>) {
  const { steps, runContract, runClassName, ...definition } = workflowValuesSchema.parse(input);
  return {
    ...definition,
    runContract,
    runClassName: runContract?.className ?? runClassName,
    steps: steps
      .filter(step => step.roleCode?.trim() || step.actionId?.trim())
      .map(({ invocationChoice, actorPolicy, ...step }, index) => ({
        ...step,
        stepNo: step.stepNo ?? index + 1,
        actionType: invocationChoice === "fixed" ? "execute" : "approve",
        invocationMode: invocationChoice === "fixed" ? "manual" : invocationChoice,
        caseScoped: Boolean(step.caseScoped),
        actorPolicy: savedPolicy(actorPolicy),
      })),
  };
}

export function workflowForm(
  t: Translate, actions: Option[], subjects: Option[], readOnly: boolean, values?: PanelFormValues,
): PanelFormDescription {
  const field = (
    name: string, schema: z.ZodTypeAny, control: PanelFormField["control"],
    options: Partial<Pick<PanelFormField, "required" | "help" | "warning">> = {}, label = name,
  ): PanelFormField => ({
    path: `/${name}`, label: t(`fields.${label}`), valueSchema: jsonSchema(schema),
    required: false, help: null, readOnly, control, ...options,
  });
  const textField = (name: string, label = name) => field(name, optionalText, { kind: "text" }, {}, label);
  const selectOptions = (options: Option[]) => options.map(option => ({
    ...option, description: null, disabled: false, disabledReason: null,
  }));
  const choices = (group: string, names: readonly string[]) =>
    selectOptions(names.map(value => ({ value, label: t(`${group}.${value}`) })));
  const principal = field("executionPrincipalId", optionalText, {
    kind: "select", allowCreate: true, options: selectOptions(subjects), placeholder: t("systemPrincipal"),
  }, { help: t("executionPrincipalHelp") });

  const fields = [
    field("name", workflowValuesSchema.shape.name, { kind: "text", placeholder: t("namePlaceholder") }, { required: true }),
    field("description", optionalText, { kind: "text", multiline: true, rows: 2 }),
    field("runContract", contractSchema.nullish(), {
      kind: "object",
      defaultObject: { className: "", statusOpen: [] },
      fields: [
        ...contractFields.map(name => textField(name)),
        field("statusOpen", statusOpen.nullish(), { kind: "string-array" }),
      ],
    }),
    field("steps", z.array(formStepSchema), {
      kind: "object-array",
      defaultItem: blankStep,
      itemFields: [
        textField("name", "stepName"),
        textField("roleCode"),
        field("actionId", optionalText, { kind: "select", allowCreate: true, options: selectOptions(actions) }, {}, "actionName"),
        field("scope", scope, { kind: "select", options: choices("scope", scopeKinds) }),
        field("invocationChoice", invocationChoice, {
          kind: "select", options: choices("invocation", invocationChoices),
        }, { help: t("automaticReserved") }),
        field("caseScoped", z.boolean(), { kind: "switch" }),
        field("actorPolicy", actorPolicySchema, {
          kind: "object",
          defaultObject: { mode: "none" },
          variantBy: "/mode",
          fields: [field("mode", policyMode, { kind: "select", options: choices("policy", policyModes) }, {}, "policyMode")],
          variants: {
            none: [],
            rule: [
              textField("metricViewId"),
              textField("metricRevision"),
              textField("principalField"),
              principal,
              ...policyObjectFields.map(name => field(name, runtimeJsonObjectSchema, { kind: "code", language: "json" })),
            ],
            agent: [
              principal,
              textField("agentId"),
              field("instruction", optionalText, { kind: "text", multiline: true, rows: 3 }),
            ],
          },
        }, { required: true }),
      ],
    }),
  ];
  return {
    fields,
    values: values ?? { name: "", description: "", runClassName: null, runContract: null, steps: [blankStep] },
    errors: [],
    save: { method: "POST", path: "/workflow/save", bodySchema: jsonSchema(workflowValuesSchema) },
  };
}
