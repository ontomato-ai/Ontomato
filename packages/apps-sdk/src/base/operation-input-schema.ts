import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { hasPanelSecretInput, normalizePanelSecretPointer, panelInputPointer, panelSchemaSecretPaths, panelSecretPathsOverlap } from "@ontomato/contracts/panel-secrets";
import { cloneJsonValue, jsonValuesEqual } from "../panel/form-values";

export type OperationInputFieldKind = "text" | "password" | "textarea" | "select" | "number" | "integer" | "boolean";

export interface OperationInputOption {
  readonly value: RuntimeJsonValue;
  readonly label: string;
}

export interface OperationInputField {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: OperationInputFieldKind;
  readonly required: boolean;
  readonly defaultValue: RuntimeJsonValue | undefined;
  readonly options?: readonly OperationInputOption[];
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

function isNullBranch(branch: unknown): boolean {
  return isObjectRecord(branch)
    && (branch.type === "null" || (Object.hasOwn(branch, "const") && branch.const === null));
}

function unwrapNullableSchema(schema: RawSchema): RawSchema {
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const { [keyword]: branches, ...outer } = schema;
    if (!Array.isArray(branches)) continue;
    const nonNull = branches.filter(branch => !isNullBranch(branch));
    const [inner] = nonNull;
    if (nonNull.length === 1 && isObjectRecord(inner) && !Object.hasOwn(inner, "const")) {
      return unwrapNullableSchema({ ...inner, ...outer, type: inner.type ?? outer.type });
    }
  }
  return schema;
}

function primaryType(type: unknown): string | undefined {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.find((item): item is string => typeof item === "string" && item !== "null");
  return undefined;
}

function enumOptions(schema: RawSchema): readonly OperationInputOption[] {
  const enumValues = Array.isArray(schema.enum) ? schema.enum as RuntimeJsonValue[] : [];
  const titledOptions: OperationInputOption[] = [];
  for (const branches of [schema.oneOf, schema.anyOf]) {
    if (!Array.isArray(branches)) continue;
    const candidates = enumValues.length ? branches : branches.filter(branch => !isNullBranch(branch));
    const choices = candidates.filter(
      (branch): branch is { const: RuntimeJsonValue; title?: unknown } =>
        isObjectRecord(branch) && Object.hasOwn(branch, "const"),
    );
    if (enumValues.length === 0 && choices.length > 0 && choices.length === candidates.length) {
      return choices.map(({ const: value, title }) => ({ value, label: typeof title === "string" ? title : String(value) }));
    }
    for (const { const: value, title } of choices) {
      if (typeof title === "string") titledOptions.push({ value, label: title });
    }
  }
  return enumValues.map(value => ({
    value,
    label: titledOptions.find(option => jsonValuesEqual(option.value, value))?.label ?? String(value),
  }));
}

function resolveKind(schema: RawSchema): { kind: OperationInputFieldKind; options?: readonly OperationInputOption[] } {
  const options = enumOptions(schema);
  if (options.length > 0) return { kind: "select", options };
  const type = primaryType(schema.type);
  if (type === "boolean") return { kind: "boolean" };
  if (type === "integer") return { kind: "integer" };
  if (type === "number") return { kind: "number" };
  if (schema.format === "textarea") return { kind: "textarea" };
  return { kind: "text" };
}

/**
 * Customer Actions (`actions.execute`) wrap all parameter inputs inside a single top-level `values` object schema
 * (`{ type: "object", properties: { values: { type: "object", properties: { ... } } }, required: ["values"] }`).
 */
export function isActionValuesEnvelope(inputSchema: Record<string, RuntimeJsonValue>): boolean {
  const root = inputSchema as RawSchema;
  if (!isObjectRecord(root.properties)) return false;
  const keys = Object.keys(root.properties);
  if (keys.length !== 1 || keys[0] !== "values") return false;
  const valuesSchema = root.properties.values;
  return isObjectRecord(valuesSchema)
    && primaryType((valuesSchema as RawSchema).type) === "object"
    && isObjectRecord((valuesSchema as RawSchema).properties);
}

/**
 * Serializes a single customer Action parameter value into the string format expected by `/action/form`:
 * - JSON-typed parameters (`contentMediaType: "application/json"`, e.g. numbers, arrays, objects) encode `null` as
 *   `"null"` so `ParameterForms.interactive` parses an explicit null without rejecting empty text.
 * - Text parameters (`TYPE_STRING`, `TYPE_TIME`) encode `null`/`undefined` as `""`.
 */
export function serializeActionParamValue(raw: unknown, isJson: boolean): string {
  if (raw === null || raw === undefined) return isJson ? "null" : "";
  if (isJson || typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/** Returns the declared `values.properties` schema map of a customer Action envelope, or `null` otherwise. */
export function actionValuesParamSchemas(
  inputSchema: Record<string, RuntimeJsonValue>,
): Readonly<Record<string, { contentMediaType?: string }>> | null {
  if (!isActionValuesEnvelope(inputSchema)) return null;
  const valuesSchema = (inputSchema.properties as Record<string, unknown>).values as {
    properties?: Record<string, { contentMediaType?: string }>;
  };
  return valuesSchema.properties ?? null;
}

/**
 * Wraps projection-bound (typed JSON) and caller/dialog-provided inputs into the `{ values: Record<string, string> }`
 * envelope required by customer Actions (`actions.execute`), serializing bound values according to each declared
 * parameter's text vs JSON schema so they match server-side `boundParams` materialization.
 */
export function wrapActionOperationInput(
  inputSchema: Record<string, RuntimeJsonValue>,
  boundParams: Readonly<Record<string, unknown>>,
  providedParams: Readonly<Record<string, unknown>> = {},
): { values: Record<string, string> } {
  const declared = actionValuesParamSchemas(inputSchema);
  const isJsonParam = (key: string): boolean => declared?.[key]?.contentMediaType === "application/json";
  const values: Record<string, string> = {};

  for (const [key, raw] of Object.entries(providedParams)) {
    if (raw === undefined || raw === null) continue;
    // Dialog inputs for `actions.execute` are already formatted strings (`type: "string"` in the envelope schema);
    // programmatic non-string extras are serialized according to the parameter schema.
    values[key] = typeof raw === "string"
      ? raw
      : serializeActionParamValue(raw, isJsonParam(key));
  }

  const boundEntries = boundParams.values
    && typeof boundParams.values === "object"
    && !Array.isArray(boundParams.values)
    ? (boundParams.values as Record<string, unknown>)
    : boundParams;
  for (const [key, raw] of Object.entries(boundEntries)) {
    if (key === "values" && boundEntries === boundParams) continue;
    if (raw === undefined) continue;
    values[key] = serializeActionParamValue(raw, isJsonParam(key));
  }

  return { values };
}

/** Agent action parameters are flat even when the owner takes an Action values envelope. */
export function hasAgentOperationSecretInput(
  descriptor: PanelOwnerOperationDescriptor,
  input: Readonly<Record<string, RuntimeJsonValue>> | undefined,
): boolean {
  if (!input) return false;
  return hasPanelSecretInput(input, descriptor)
    || (isActionValuesEnvelope(descriptor.inputSchema) && hasPanelSecretInput({ values: input }, descriptor));
}

/**
 * Extracts editable parameter fields from an owner operation's JSON Schema `inputSchema`.
 * Excludes any keys already bound by the projection (`operation.params`) so the dialog never prompts for them.
 */
export function operationInputFields(
  inputSchema: Record<string, RuntimeJsonValue>,
  excludeKeys: ReadonlySet<string> = new Set(),
  secretFields: readonly string[] = [],
): readonly OperationInputField[] {
  const enveloped = isActionValuesEnvelope(inputSchema);
  const declared = [...secretFields.map(normalizePanelSecretPointer), ...panelSchemaSecretPaths(inputSchema)];
  const root = (enveloped
    ? ((inputSchema as RawSchema).properties as Record<string, unknown>).values
    : inputSchema) as RawSchema;
  if (!isObjectRecord(root.properties)) return [];
  const required = new Set(
    Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === "string") : [],
  );
  const fields: OperationInputField[] = [];
  for (const [name, rawProperty] of Object.entries(root.properties)) {
    if (excludeKeys.has(name) || !isObjectRecord(rawProperty)) continue;
    const schema = unwrapNullableSchema(rawProperty as RawSchema);
    const path = (enveloped ? "/values" : "") + panelInputPointer(name);
    const secret = declared.some(pointer => panelSecretPathsOverlap(path, pointer));
    const { kind, options } = secret ? { kind: "password" as const, options: undefined } : resolveKind(schema);
    fields.push({
      name,
      label: (typeof schema.title === "string" && schema.title.trim()) || name,
      ...(typeof schema.description === "string" && schema.description.trim() ? { description: schema.description } : {}),
      kind,
      required: required.has(name),
      defaultValue: secret || schema.default === undefined ? undefined : cloneJsonValue(schema.default as RuntimeJsonValue),
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
