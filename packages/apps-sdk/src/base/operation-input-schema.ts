import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { cloneJsonValue } from "../panel/form-values";

export type OperationInputFieldKind = "text" | "textarea" | "select" | "number" | "integer" | "boolean";

export interface OperationInputField {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: OperationInputFieldKind;
  readonly required: boolean;
  readonly defaultValue: RuntimeJsonValue | undefined;
  readonly options?: readonly RuntimeJsonValue[];
  readonly min?: number;
  readonly max?: number;
}

interface RawSchema {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  default?: unknown;
  enum?: unknown;
  format?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  properties?: unknown;
  required?: unknown;
  anyOf?: unknown;
  oneOf?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unwrapNullableSchema(schema: RawSchema): RawSchema {
  const branches = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (!branches) return schema;
  const nonNull = branches.filter(
    (branch): branch is RawSchema => isObjectRecord(branch) && branch.type !== "null",
  );
  if (nonNull.length !== 1) return schema;
  return { ...nonNull[0], ...schema, type: nonNull[0]!.type ?? schema.type };
}

function primaryType(type: unknown): string | undefined {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.find((item): item is string => typeof item === "string" && item !== "null");
  return undefined;
}

function resolveKind(schema: RawSchema): { kind: OperationInputFieldKind; options?: readonly RuntimeJsonValue[] } {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { kind: "select", options: schema.enum as RuntimeJsonValue[] };
  }
  const type = primaryType(schema.type);
  if (type === "boolean") return { kind: "boolean" };
  if (type === "integer") return { kind: "integer" };
  if (type === "number") return { kind: "number" };
  if (schema.format === "textarea") return { kind: "textarea" };
  return { kind: "text" };
}

/**
 * Extracts editable parameter fields from an owner operation's JSON Schema `inputSchema`.
 * Excludes any keys already bound by the projection (`operation.params`) so the dialog never prompts for them.
 */
export function operationInputFields(
  inputSchema: Record<string, RuntimeJsonValue>,
  excludeKeys: ReadonlySet<string> = new Set(),
): readonly OperationInputField[] {
  const root = inputSchema as RawSchema;
  if (!isObjectRecord(root.properties)) return [];
  const required = new Set(
    Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === "string") : [],
  );
  const fields: OperationInputField[] = [];
  for (const [name, rawProperty] of Object.entries(root.properties)) {
    if (excludeKeys.has(name) || !isObjectRecord(rawProperty)) continue;
    const schema = unwrapNullableSchema(rawProperty as RawSchema);
    const { kind, options } = resolveKind(schema);
    fields.push({
      name,
      label: typeof schema.title === "string" && schema.title.trim() ? schema.title : name,
      ...(typeof schema.description === "string" && schema.description.trim() ? { description: schema.description } : {}),
      kind,
      required: required.has(name),
      defaultValue: schema.default === undefined ? undefined : cloneJsonValue(schema.default as RuntimeJsonValue),
      ...(options ? { options } : {}),
      ...(typeof schema.minimum === "number" ? { min: schema.minimum } : {}),
      ...(typeof schema.maximum === "number" ? { max: schema.maximum } : {}),
    });
  }
  return fields;
}

export type OperationInputDraft = Record<string, unknown>;

/** Builds initial dialog form values from the schema's defaults and field kinds. */
export function initialOperationInputDraft(fields: readonly OperationInputField[]): OperationInputDraft {
  const draft: OperationInputDraft = {};
  for (const field of fields) {
    if (field.kind === "boolean") {
      draft[field.name] = typeof field.defaultValue === "boolean" ? field.defaultValue : false;
    } else if (field.kind === "number" || field.kind === "integer") {
      draft[field.name] = typeof field.defaultValue === "number" ? String(field.defaultValue) : "";
    } else if (field.kind === "select") {
      draft[field.name] = field.defaultValue !== undefined ? cloneJsonValue(field.defaultValue) : undefined;
    } else {
      draft[field.name] = typeof field.defaultValue === "string" ? field.defaultValue : "";
    }
  }
  return draft;
}

export type OperationInputValidationIssue =
  | { readonly kind: "required"; readonly field: OperationInputField }
  | { readonly kind: "number"; readonly field: OperationInputField }
  | { readonly kind: "integer"; readonly field: OperationInputField };

/**
 * Validates the dialog draft against required and numeric/integer constraints and builds the JSON object
 * passed to `writeOperation` or `readOperation`.
 */
export function buildOperationInput(
  fields: readonly OperationInputField[],
  draft: Readonly<OperationInputDraft>,
): { ok: true; value: Record<string, RuntimeJsonValue> } | { ok: false; issues: readonly OperationInputValidationIssue[] } {
  const issues: OperationInputValidationIssue[] = [];
  const value: Record<string, RuntimeJsonValue> = {};

  for (const field of fields) {
    const raw = draft[field.name];
    if (field.kind === "boolean") {
      value[field.name] = Boolean(raw);
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
      if (!text) {
        if (field.required) issues.push({ kind: "required", field });
        continue;
      }
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) {
        issues.push({ kind: "number", field });
        continue;
      }
      if (field.kind === "integer" && !Number.isInteger(parsed)) {
        issues.push({ kind: "integer", field });
        continue;
      }
      value[field.name] = parsed;
      continue;
    }
    if (field.kind === "select") {
      if (raw === undefined || raw === null || raw === "") {
        if (field.required) issues.push({ kind: "required", field });
        continue;
      }
      value[field.name] = raw as RuntimeJsonValue;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (!text.trim()) {
      if (field.required) issues.push({ kind: "required", field });
      else if (field.defaultValue === "" || text !== "") value[field.name] = text;
      continue;
    }
    value[field.name] = text;
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}
