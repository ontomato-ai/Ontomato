import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";

interface FormChoiceOption {
  readonly value: RuntimeJsonValue;
  readonly label: string;
}

/** One modified field row rendered in `ObjectForm`'s optional change comparison summary. */
export interface FormChangeSummaryEntry {
  readonly path: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export interface FormChangeSummaryOptions {
  readonly locale?: string;
  readonly secretPaths?: ReadonlySet<string>;
  readonly translate?: (key: string) => string;
  readonly emptyPlaceholder?: string;
}

const MASKED_SECRET = "••••••";

function isPlainObject(value: unknown): value is Record<string, RuntimeJsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerSegments(pointer: string): readonly string[] {
  if (!pointer || pointer === "/") return [];
  return pointer
    .replace(/^\//, "")
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function readPointerValue(values: PanelFormValues | null | undefined, pointer: string): RuntimeJsonValue | undefined {
  if (!values) return undefined;
  let current: unknown = values;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, segment)) return undefined;
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current as RuntimeJsonValue | undefined;
}

function jsonEqual(left: RuntimeJsonValue | undefined, right: RuntimeJsonValue | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
    const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
  }
  return false;
}

function activeObjectFields(
  control: Extract<PanelFormField["control"], { kind: "object" }>,
  current: RuntimeJsonValue | undefined,
): readonly PanelFormField[] {
  if (!control.variants || !control.variantBy) return control.fields;
  const discriminator = isPlainObject(current) ? readPointerValue(current, control.variantBy) : undefined;
  const variantKey = typeof discriminator === "string"
    ? discriminator
    : typeof discriminator === "number" || typeof discriminator === "boolean"
      ? String(discriminator)
      : undefined;
  const variantFields = variantKey ? control.variants[variantKey] : undefined;
  return variantFields ? [...control.fields, ...variantFields] : control.fields;
}

function fieldOptionsOf(field: PanelFormField): readonly FormChoiceOption[] | undefined {
  const { control } = field;
  if ("options" in control && Array.isArray(control.options)) {
    return control.options as readonly FormChoiceOption[];
  }
  return undefined;
}

function optionLabelFor(
  options: readonly FormChoiceOption[] | undefined,
  value: RuntimeJsonValue,
): string | undefined {
  if (!options) return undefined;
  const found = options.find((option) => jsonEqual(option.value, value));
  return found?.label;
}

function isSecretField(field: PanelFormField, absolutePath: string, secretPaths?: ReadonlySet<string>): boolean {
  if (field.control.kind === "text" && field.control.secret === true) return true;
  if (!secretPaths || secretPaths.size === 0) return false;
  if (secretPaths.has(absolutePath)) return true;
  for (const secretPath of secretPaths) {
    if (absolutePath.startsWith(`${secretPath}/`)) return true;
  }
  return false;
}

function hasSecretValue(value: RuntimeJsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (isPlainObject(value)) {
    if ("present" in value && value.present === true) return true;
    return Object.values(value).some((entry) => entry !== null && entry !== undefined && entry !== "");
  }
  return true;
}

function formatLocalizedMap(
  map: Record<string, RuntimeJsonValue>,
  locale: string | undefined,
  emptyPlaceholder: string,
): string {
  const entries = Object.entries(map).filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  if (entries.length === 0) return emptyPlaceholder;
  if (locale) {
    const exact = entries.find(([key]) => key.toLowerCase() === locale.toLowerCase());
    if (exact) return String(exact[1]);
    const prefix = locale.split("-")[0]?.toLowerCase();
    if (prefix) {
      const partial = entries.find(([key]) => key.toLowerCase() === prefix || key.toLowerCase().startsWith(`${prefix}-`));
      if (partial) return String(partial[1]);
    }
  }
  return entries.map(([, value]) => String(value)).join(" / ");
}

function formatBoolean(value: boolean, translate?: (key: string) => string): string {
  const key = value ? "platform.booleanTrue" : "platform.booleanFalse";
  if (translate) {
    const translated = translate(key);
    if (translated && translated !== key) return translated;
  }
  return value ? "true" : "false";
}

function formatChangeValue(
  field: PanelFormField,
  value: RuntimeJsonValue | undefined,
  secret: boolean,
  options: FormChangeSummaryOptions,
): string {
  const emptyPlaceholder = options.emptyPlaceholder ?? "—";
  if (secret) {
    return hasSecretValue(value) ? MASKED_SECRET : emptyPlaceholder;
  }
  if (value === undefined || value === null) return emptyPlaceholder;
  if (typeof value === "string") {
    if (value === "") return emptyPlaceholder;
    return optionLabelFor(fieldOptionsOf(field), value) ?? value;
  }
  if (typeof value === "number") {
    return optionLabelFor(fieldOptionsOf(field), value) ?? String(value);
  }
  if (typeof value === "boolean") {
    return optionLabelFor(fieldOptionsOf(field), value) ?? formatBoolean(value, options.translate);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return emptyPlaceholder;
    const choices = fieldOptionsOf(field);
    return value
      .map((item) => {
        if (item === null) return emptyPlaceholder;
        const matched = optionLabelFor(choices, item);
        if (matched !== undefined) return matched;
        if (typeof item === "boolean") return formatBoolean(item, options.translate);
        if (typeof item === "string" || typeof item === "number") return String(item);
        return JSON.stringify(item);
      })
      .join(", ");
  }
  if (field.control.kind === "localized-text" && isPlainObject(value)) {
    return formatLocalizedMap(value, options.locale, emptyPlaceholder);
  }
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return emptyPlaceholder;
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Collects human-readable before/after entries for every visible editable field whose current
 * value differs from the baseline snapshot. Nested `object` fields are expanded into their
 * active child fields so individual edits stay concise and scannable.
 */
export function collectFormChangeSummary(
  fields: readonly PanelFormField[],
  before: PanelFormValues | null | undefined,
  after: PanelFormValues | null | undefined,
  options: FormChangeSummaryOptions = {},
): readonly FormChangeSummaryEntry[] {
  if (!before || !after) return [];
  const entries: FormChangeSummaryEntry[] = [];

  const visit = (
    list: readonly PanelFormField[],
    basePath: string,
    parentLabel: string | null,
    inheritedReadOnly: boolean,
  ) => {
    for (const field of list) {
      if (field.control.kind === "hidden") continue;
      const readOnly = inheritedReadOnly || Boolean(field.readOnly);
      if (readOnly) continue;

      const absPath = basePath + field.path;
      const label = parentLabel ? `${parentLabel} · ${field.label}` : field.label;
      const beforeVal = readPointerValue(before, absPath);
      const afterVal = readPointerValue(after, absPath);

      if (jsonEqual(beforeVal, afterVal)) continue;

      if (
        field.control.kind === "object"
        && (beforeVal === undefined || isPlainObject(beforeVal))
        && (afterVal === undefined || isPlainObject(afterVal))
      ) {
        const activeChildren = activeObjectFields(field.control, afterVal ?? beforeVal);
        if (activeChildren.length > 0) {
          const beforeCount = entries.length;
          visit(activeChildren, absPath, label, readOnly);
          if (entries.length > beforeCount) continue;
        }
      }

      const secret = isSecretField(field, absPath, options.secretPaths);
      entries.push({
        path: absPath,
        label,
        from: formatChangeValue(field, beforeVal, secret, options),
        to: formatChangeValue(field, afterVal, secret, options),
      });
    }
  };

  visit(fields, "", null, false);
  return entries;
}
