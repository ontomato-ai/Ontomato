/**
 * The creation wizard follows the order a person actually designs an Action:
 * object class -> operation -> interface parameters -> execution conditions -> concrete rules.
 *
 * It edits an intent, not the derived definition returned by the API. The projection is descriptive
 * (`source=DERIVED`, `verified=false`); it seeds the wizard and previews the last draft.
 */

export type OperationFamily = "OBJECT" | "RELATION" | "VECTOR" | "EXTERNAL";

export type OperationKind =
  | "CREATE_OBJECT"
  | "UPDATE_OBJECT"
  | "DELETE_OBJECT"
  | "CREATE_EDGE"
  | "DELETE_EDGE"
  | "APPEND_VECTOR"
  | "UPDATE_VECTOR"
  | "DELETE_VECTOR"
  | "EXTERNAL_CALL";

export interface IntentParameter {
  name: string;
  type: string;
  className: string;
  description: string;
}

export interface IntentCondition {
  className: string;
  field: string;
  operator: string;
  value: string;
  message: string;
}

export type ValueSource = "CONSTANT" | "PARAMETER" | "EXPRESSION";

export interface ObjectRule {
  field: string;
  source: ValueSource;
  value: string;
}

export interface RelationRule {
  relation: string;
  sourceClass: string;
  sourceId: string;
  targetClass: string;
  targetId: string;
}

export interface VectorRule {
  attribute: string;
  source: "TEXT" | "FILE";
  value: string;
}

export interface ExternalRule {
  service: string;
  action: string;
  payload: string;
  output: string;
}

export interface ObjectRules {
  locator: string;
  assignments: ObjectRule[];
  deleteRelations: boolean;
}

export interface ActionIntent {
  family: OperationFamily;
  operation: OperationKind;
  primaryClass: string;
  name: string;
  description: string;
  parameters: IntentParameter[];
  criteriaOperator: "AND" | "OR";
  conditions: IntentCondition[];
  unrepresentable: string[];
  objectRules: ObjectRules;
  relationRules: RelationRule;
  vectorRules: VectorRule;
  external: ExternalRule;
}

const FAMILY_BY_OPERATION: Record<OperationKind, OperationFamily> = {
  CREATE_OBJECT: "OBJECT",
  UPDATE_OBJECT: "OBJECT",
  DELETE_OBJECT: "OBJECT",
  CREATE_EDGE: "RELATION",
  DELETE_EDGE: "RELATION",
  APPEND_VECTOR: "VECTOR",
  UPDATE_VECTOR: "VECTOR",
  DELETE_VECTOR: "VECTOR",
  EXTERNAL_CALL: "EXTERNAL",
};

const OPERATIONS: Record<OperationFamily, OperationKind[]> = {
  OBJECT: ["CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT"],
  RELATION: ["CREATE_EDGE", "DELETE_EDGE"],
  VECTOR: ["APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR"],
  EXTERNAL: ["EXTERNAL_CALL"],
};

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

export function familyOf(operation: OperationKind): OperationFamily {
  return FAMILY_BY_OPERATION[operation];
}

export function operationsFor(family: OperationFamily): OperationKind[] {
  return OPERATIONS[family];
}

export function defaultOperation(family: OperationFamily): OperationKind {
  return OPERATIONS[family][0];
}

export function emptyIntent(): ActionIntent {
  return {
    family: "OBJECT",
    operation: "UPDATE_OBJECT",
    primaryClass: "",
    name: "",
    description: "",
    parameters: [],
    criteriaOperator: "AND",
    conditions: [],
    unrepresentable: [],
    objectRules: { locator: "", assignments: [], deleteRelations: false },
    relationRules: { relation: "", sourceClass: "", sourceId: "", targetClass: "", targetId: "" },
    vectorRules: { attribute: "", source: "TEXT", value: "" },
    external: { service: "", action: "", payload: "", output: "" },
  };
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function rulesFromEffects(effects: any[]): {
  family: OperationFamily;
  operation: OperationKind;
  primaryClass: string;
  objectRules: ObjectRules;
  relationRules: RelationRule;
  vectorRules: VectorRule;
  external: ExternalRule;
} {
  const effect = effects[0] ?? {};
  const kind = text(effect.kind) as OperationKind;
  const family = FAMILY_BY_OPERATION[kind] ?? "OBJECT";
  const objectRules: ObjectRules = { locator: "", assignments: [], deleteRelations: false };
  const relationRules: RelationRule = { relation: "", sourceClass: "", sourceId: "", targetClass: "", targetId: "" };
  const vectorRules: VectorRule = { attribute: "", source: "TEXT", value: "" };
  const external: ExternalRule = { service: "", action: "", payload: "", output: "" };

  if (family === "OBJECT") {
    objectRules.locator = text(effect.objectIdFrom);
    for (const effectItem of effects) {
      for (const assignment of effectItem.assignments ?? []) {
        const raw = text(assignment.valueFrom);
        const source: ValueSource = raw.startsWith("Parameter ")
          ? "PARAMETER"
          : raw.startsWith("固定值")
            ? "CONSTANT"
            : "EXPRESSION";
        objectRules.assignments.push({
          field: text(assignment.field),
          source,
          value: raw.replace(/^Parameter\s+/, "").replace(/^固定值\s*/, ""),
        });
      }
    }
  } else if (family === "RELATION") {
    relationRules.relation = text(effect.relation);
    relationRules.sourceClass = text(effect.sourceClass);
    relationRules.sourceId = text(effect.sourceObjectIdFrom);
    relationRules.targetClass = text(effect.targetClass);
    relationRules.targetId = text(effect.targetObjectIdFrom);
  } else if (family === "VECTOR") {
    vectorRules.attribute = text(effect.attrName);
    vectorRules.source = effect.textFrom ? "TEXT" : "FILE";
    vectorRules.value = text(effect.textFrom ?? effect.fileIdFrom);
  } else {
    external.payload = text(effect.narrative);
  }

  return {
    family,
    operation: kind,
    primaryClass:
      text(effect.className ?? effect.sourceClass ?? effect.targetClass) ||
      text(effects.find((item) => item.className)?.className),
    objectRules,
    relationRules,
    vectorRules,
    external,
  };
}

/** Seeds the wizard from a generated or saved action (preferring the derived projection). */
export function intentFromAction(action: any): ActionIntent {
  const definition = action?.definition ?? {};
  const effects = Array.isArray(definition.effects) ? definition.effects : [];
  const parameters = Array.isArray(definition.parameters)
    ? definition.parameters
    : (action?.function?.parameters ?? []);
  const criteria = action?.submissionCriteria ?? definition.submissionCriteria;
  const mapped = rulesFromEffects(effects);

  return {
    ...emptyIntent(),
    ...mapped,
    name: text(action?.name ?? definition.name),
    description: text(action?.description ?? definition.description),
    parameters: parameters.map((parameter: any) => ({
      name: text(parameter?.name),
      type: TYPE_MAP[text(parameter?.type)] ?? text(parameter?.type) ?? "STRING",
      className: text(parameter?.objectTypes?.[0] ?? parameter?.classNames?.[0] ?? parameter?.className),
      description: text(parameter?.description),
    })),
    criteriaOperator: criteria?.operator === "OR" ? "OR" : "AND",
    conditions: Array.isArray(criteria?.conditions)
      ? criteria.conditions.map((condition: any) => ({
          className: text(condition?.className ?? condition?.object),
          field: text(condition?.field),
          operator: text(condition?.operator) || "IS",
          value: text(condition?.value),
          message: text(condition?.message),
        }))
      : [],
    unrepresentable: Array.isArray(criteria?.unrepresentable)
      ? criteria.unrepresentable.map((item: any) =>
          typeof item === "string"
            ? item
            : [text(item?.description), text(item?.reason)].filter(Boolean).join(" — ")
        )
      : [],
  };
}

function hasContent(intent: ActionIntent): boolean {
  return Boolean(
    intent.primaryClass.trim() ||
      intent.name.trim() ||
      intent.description.trim() ||
      intent.parameters.length ||
      intent.conditions.length ||
      intent.objectRules.assignments.length ||
      intent.relationRules.relation.trim() ||
      intent.vectorRules.attribute.trim() ||
      intent.external.service.trim()
  );
}

/** Compiles the intent into the optional `structuredSpec` accepted by the generation endpoint. */
export function compileStructuredSpec(intent: ActionIntent): Record<string, unknown> | null {
  if (!hasContent(intent)) return null;
  const spec: Record<string, unknown> = {
    family: intent.family,
    operation: intent.operation,
  };
  if (intent.primaryClass.trim()) spec.primaryObject = intent.primaryClass.trim();
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

  const conditions = intent.conditions
    .filter((condition) => condition.className.trim() || condition.field.trim())
    .map((condition) => ({
      object: condition.className.trim(),
      field: condition.field.trim(),
      operator: condition.operator,
      value: condition.value,
      ...(condition.message.trim() ? { message: condition.message.trim() } : {}),
    }));
  const unrepresentable = intent.unrepresentable.map((item) => item.trim()).filter(Boolean);
  if (conditions.length || unrepresentable.length) {
    spec.executionConditions = { operator: intent.criteriaOperator, conditions, unrepresentable };
  }

  if (intent.family === "OBJECT") {
    spec.objectRules = {
      ...(intent.objectRules.locator.trim() ? { locator: intent.objectRules.locator.trim() } : {}),
      assignments: intent.objectRules.assignments
        .filter((rule) => rule.field.trim() || rule.value.trim())
        .map((rule) => ({ field: rule.field.trim(), source: rule.source, value: rule.value })),
      ...(intent.operation === "DELETE_OBJECT"
        ? { deleteRelations: intent.objectRules.deleteRelations }
        : {}),
    };
  } else if (intent.family === "RELATION") {
    spec.relationRules = {
      relation: intent.relationRules.relation.trim(),
      source: { class: intent.relationRules.sourceClass.trim(), id: intent.relationRules.sourceId.trim() },
      target: { class: intent.relationRules.targetClass.trim(), id: intent.relationRules.targetId.trim() },
    };
  } else if (intent.family === "VECTOR") {
    spec.vectorRules = {
      object: intent.primaryClass.trim(),
      attribute: intent.vectorRules.attribute.trim(),
      source: intent.vectorRules.source,
      value: intent.vectorRules.value.trim(),
    };
  } else {
    spec.external = {
      service: intent.external.service.trim(),
      action: intent.external.action.trim(),
      payload: intent.external.payload.trim(),
      output: intent.external.output.trim(),
    };
  }
  return spec;
}

export function validateStep(step: number, intent: ActionIntent): boolean {
  if (step === 0) return Boolean(intent.primaryClass.trim());
  if (step === 1) return operationsFor(intent.family).includes(intent.operation);
  if (step === 2) return intent.parameters.every((parameter) => Boolean(parameter.name.trim()));
  if (step === 3) {
    return intent.conditions.every(
      (condition) =>
        !condition.field.trim() ||
        Boolean(condition.className.trim() && condition.operator.trim())
    );
  }
  if (step === 4) {
    if (intent.family === "OBJECT") {
      if (intent.operation !== "CREATE_OBJECT" && !intent.objectRules.locator.trim()) return false;
      return intent.objectRules.assignments.every(
        (rule) => !rule.field.trim() || Boolean(rule.value.trim())
      );
    }
    if (intent.family === "RELATION") {
      return Boolean(
        intent.relationRules.relation.trim() &&
          intent.relationRules.sourceClass.trim() &&
          intent.relationRules.sourceId.trim() &&
          intent.relationRules.targetClass.trim() &&
          intent.relationRules.targetId.trim()
      );
    }
    if (intent.family === "VECTOR") {
      return Boolean(intent.vectorRules.attribute.trim() && intent.vectorRules.value.trim());
    }
    return Boolean(intent.external.service.trim() || intent.external.action.trim());
  }
  return true;
}

/** Suggested interface parameters for the selected operation. */
export function suggestedParameters(intent: ActionIntent): IntentParameter[] {
  const primary = intent.primaryClass.trim();
  if (intent.family === "OBJECT") {
    if (intent.operation === "CREATE_OBJECT") return [];
    return [{ name: "object_id", type: "STRING", className: primary, description: "" }];
  }
  if (intent.family === "RELATION") {
    return [
      { name: "source_id", type: "STRING", className: intent.relationRules.sourceClass || primary, description: "" },
      { name: "target_id", type: "STRING", className: intent.relationRules.targetClass, description: "" },
    ];
  }
  if (intent.family === "VECTOR") {
    return [
      { name: "object_id", type: "STRING", className: primary, description: "" },
      intent.vectorRules.source === "FILE"
        ? { name: "file", type: "FILE", className: "", description: "" }
        : { name: "text", type: "STRING", className: "", description: "" },
    ];
  }
  return [];
}

/** A short instruction used when regenerating from the panel without a new chat message. */
export function intentInstruction(intent: ActionIntent): string {
  const parts = [`Generate the ${intent.operation} action`];
  if (intent.primaryClass.trim()) parts.push(`on ${intent.primaryClass.trim()}`);
  if (intent.name.trim()) parts.push(`named ${intent.name.trim()}`);
  if (intent.description.trim()) parts.push(`- ${intent.description.trim()}`);
  return `${parts.join(" ")}. Follow the structured setup exactly.`;
}
