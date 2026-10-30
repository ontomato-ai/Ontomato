/**
 * The creation wizard edits an intent, not the derived definition returned by the API.
 * The projection is descriptive (`source=DERIVED`, `verified=false`); it seeds the wizard and
 * previews the last draft, while the intent remains the user's confirmed requirement.
 */

export type ActionType = "CREATE" | "UPDATE" | "DELETE" | "LINK" | "VECTOR" | "EXTERNAL";

export interface IntentParameter {
  name: string;
  type: string;
  className: string;
  description: string;
}

export interface IntentRule {
  kind: string;
  object: string;
  field: string;
  value: string;
}

export interface IntentCondition {
  object: string;
  field: string;
  operator: string;
  value: string;
  message: string;
}

export interface IntentCriteria {
  operator: "AND" | "OR";
  conditions: IntentCondition[];
  unrepresentable: string[];
}

export interface ActionIntent {
  actionType: ActionType;
  targetObject: string;
  name: string;
  description: string;
  parameters: IntentParameter[];
  rules: IntentRule[];
  criteria: IntentCriteria | null;
}

const OBJECT_KINDS = new Set(["CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT"]);
const EDGE_KINDS = new Set(["CREATE_EDGE", "DELETE_EDGE"]);
const VECTOR_KINDS = new Set(["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"]);

const TYPE_MAP: Record<string, string> = {
  TYPE_STRING: "STRING",
  TYPE_NUMBER: "NUMBER",
  TYPE_TIME: "TIMESTAMP",
  TYPE_STRING_ARRAY: "ARRAY<STRING>",
  TYPE_NUMBER_ARRAY: "ARRAY<NUMBER>",
  TYPE_TIME_ARRAY: "ARRAY<TIMESTAMP>",
  TYPE_ONTOOBJ: "OBJECT_REFERENCE",
  TYPE_DATASET: "OBJECT_SET",
  TYPE_VECTOR: "FILE",
};

export function emptyIntent(): ActionIntent {
  return {
    actionType: "UPDATE",
    targetObject: "",
    name: "",
    description: "",
    parameters: [],
    rules: [],
    criteria: null,
  };
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function actionTypeFrom(effects: any[]): ActionType {
  const kinds = effects.map((effect) => String(effect?.kind ?? ""));
  if (kinds.some((kind) => kind === "EXTERNAL_CALL")) return "EXTERNAL";
  if (kinds.some((kind) => VECTOR_KINDS.has(kind))) return "VECTOR";
  if (kinds.some((kind) => EDGE_KINDS.has(kind))) return "LINK";
  if (kinds.some((kind) => kind === "CREATE_OBJECT")) return "CREATE";
  if (kinds.some((kind) => kind === "DELETE_OBJECT")) return "DELETE";
  return "UPDATE";
}

function rulesFrom(effects: any[]): IntentRule[] {
  const rules: IntentRule[] = [];
  for (const effect of effects) {
    const kind = String(effect?.kind ?? "");
    if (OBJECT_KINDS.has(kind)) {
      const assignments = Array.isArray(effect?.assignments) ? effect.assignments : [];
      if (!assignments.length) {
        rules.push({ kind, object: text(effect?.className), field: "", value: "" });
        continue;
      }
      for (const assignment of assignments) {
        rules.push({
          kind,
          object: text(effect?.className),
          field: text(assignment?.field),
          value: text(assignment?.valueFrom),
        });
      }
    } else if (EDGE_KINDS.has(kind)) {
      rules.push({
        kind,
        object: [text(effect?.sourceClass), text(effect?.targetClass)].filter(Boolean).join(" → "),
        field: text(effect?.relation),
        value: [
          effect?.sourceObjectIdFrom ? `source ← ${text(effect.sourceObjectIdFrom)}` : "",
          effect?.targetObjectIdFrom ? `target ← ${text(effect.targetObjectIdFrom)}` : "",
        ]
          .filter(Boolean)
          .join("; "),
      });
    } else if (VECTOR_KINDS.has(kind)) {
      rules.push({
        kind,
        object: text(effect?.className),
        field: text(effect?.attrName),
        value: text(effect?.textFrom ?? effect?.fileIdFrom),
      });
    } else if (kind === "EXTERNAL_CALL") {
      rules.push({ kind, object: "", field: "", value: text(effect?.narrative) });
    }
  }
  return rules;
}

function criteriaFrom(value: any): IntentCriteria | null {
  if (!value || typeof value !== "object") return null;
  const conditions = Array.isArray(value.conditions)
    ? value.conditions.map((condition: any) => ({
        object: text(condition?.className ?? condition?.object),
        field: text(condition?.field),
        operator: text(condition?.operator) || "IS",
        value: text(condition?.value),
        message: text(condition?.message),
      }))
    : [];
  const unrepresentable = Array.isArray(value.unrepresentable)
    ? value.unrepresentable.map((item: any) =>
        typeof item === "string"
          ? item
          : [text(item?.description), text(item?.reason)].filter(Boolean).join(" — ")
      )
    : [];
  if (!conditions.length && !unrepresentable.length) return null;
  return {
    operator: value.operator === "OR" ? "OR" : "AND",
    conditions,
    unrepresentable,
  };
}

/** Seeds the wizard from a generated or saved action (preferring the derived projection). */
export function intentFromAction(action: any): ActionIntent {
  const definition = action?.definition ?? {};
  const effects = Array.isArray(definition.effects) ? definition.effects : [];
  const parameters = Array.isArray(definition.parameters)
    ? definition.parameters
    : (action?.function?.parameters ?? []);
  const rules = rulesFrom(effects);
  const criteria = criteriaFrom(action?.submissionCriteria ?? definition.submissionCriteria);
  const targetObject =
    text(effects[0]?.className ?? effects[0]?.sourceClass ?? effects[0]?.targetClass) ||
    text(parameters.find((parameter: any) => parameter?.objectTypes?.length)?.objectTypes?.[0]) ||
    "";

  return {
    actionType: actionTypeFrom(effects),
    targetObject,
    name: text(action?.name ?? definition.name),
    description: text(action?.description ?? definition.description),
    parameters: parameters.map((parameter: any) => ({
      name: text(parameter?.name),
      type: TYPE_MAP[text(parameter?.type)] ?? text(parameter?.type) ?? "STRING",
      className: text(parameter?.objectTypes?.[0] ?? parameter?.classNames?.[0] ?? parameter?.className),
      description: text(parameter?.description),
    })),
    rules,
    criteria,
  };
}

function intentHasContent(intent: ActionIntent): boolean {
  return Boolean(
    intent.targetObject.trim() ||
      intent.name.trim() ||
      intent.description.trim() ||
      intent.parameters.length ||
      intent.rules.length ||
      intent.criteria ||
      intent.actionType !== "UPDATE"
  );
}

/** Compiles the intent into the optional `structuredSpec` accepted by the generation endpoint. */
export function compileStructuredSpec(intent: ActionIntent): Record<string, unknown> | null {
  if (!intentHasContent(intent)) return null;
  const spec: Record<string, unknown> = { actionType: intent.actionType };
  if (intent.targetObject.trim()) spec.targetObject = intent.targetObject.trim();
  if (intent.name.trim()) spec.name = intent.name.trim();
  if (intent.description.trim()) spec.description = intent.description.trim();
  const parameters = intent.parameters.filter((parameter) => parameter.name.trim());
  if (parameters.length) {
    spec.parameters = parameters.map((parameter) => ({
      name: parameter.name.trim(),
      type: parameter.type,
      ...(parameter.className.trim() ? { class: parameter.className.trim() } : {}),
      ...(parameter.description.trim() ? { description: parameter.description.trim() } : {}),
    }));
  }
  const rules = intent.rules.filter((rule) => rule.object.trim() || rule.field.trim() || rule.value.trim());
  if (rules.length) {
    spec.writeRules = rules.map((rule) => ({
      kind: rule.kind,
      ...(rule.object.trim() ? { object: rule.object.trim() } : {}),
      ...(rule.field.trim() ? { field: rule.field.trim() } : {}),
      ...(rule.value.trim() ? { value: rule.value.trim() } : {}),
    }));
  }
  if (intent.criteria) {
    const conditions = intent.criteria.conditions
      .filter((condition) => condition.object.trim() || condition.field.trim())
      .map((condition) => ({
        object: condition.object.trim(),
        field: condition.field.trim(),
        operator: condition.operator,
        value: condition.value,
        ...(condition.message.trim() ? { message: condition.message.trim() } : {}),
      }));
    const unrepresentable = intent.criteria.unrepresentable
      .map((item) => item.trim())
      .filter(Boolean);
    if (conditions.length || unrepresentable.length) {
      spec.submissionCriteria = {
        operator: intent.criteria.operator,
        conditions,
        unrepresentable,
      };
    }
  }
  return spec;
}

export function validateStep(step: number, intent: ActionIntent): boolean {
  if (step === 0) {
    return intent.actionType === "EXTERNAL" ? Boolean(intent.name.trim()) : Boolean(intent.targetObject.trim());
  }
  if (step === 1) return intent.parameters.every((parameter) => Boolean(parameter.name.trim()));
  if (step === 2) {
    return intent.rules.every(
      (rule) => !rule.object.trim() && !rule.field.trim() && !rule.value.trim() ? true : Boolean(rule.object.trim())
    );
  }
  if (step === 3) {
    if (!intent.criteria) return true;
    return intent.criteria.conditions.every(
      (condition) =>
        !condition.object.trim() && !condition.field.trim()
          ? true
          : Boolean(condition.object.trim() && condition.field.trim() && condition.operator.trim())
    );
  }
  return true;
}

/** A short instruction used when regenerating from the panel without a new chat message. */
export function intentInstruction(intent: ActionIntent): string {
  const parts = [`Generate the ${intent.actionType} action`];
  if (intent.targetObject.trim()) parts.push(`on ${intent.targetObject.trim()}`);
  if (intent.name.trim()) parts.push(`named ${intent.name.trim()}`);
  if (intent.description.trim()) parts.push(`- ${intent.description.trim()}`);
  return `${parts.join(" ")}. Follow the structured setup exactly.`;
}
