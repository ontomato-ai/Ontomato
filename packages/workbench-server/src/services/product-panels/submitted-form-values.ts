import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { HttpError } from "../../utils/errors";

function field(value: RuntimeJsonValue | undefined, key: string): RuntimeJsonValue | undefined {
  if (value === null || typeof value !== "object" || !Object.prototype.propertyIsEnumerable.call(value, key))
    return undefined;
  return Array.isArray(value) ? value[Number(key)] : value[key];
}

function replace(
  current: RuntimeJsonValue | undefined, submitted: RuntimeJsonValue | undefined, [key, ...rest]: string[], pointer: string,
): RuntimeJsonValue {
  if (submitted === undefined) throw new HttpError(400, `Missing value for submitted field ${pointer}`, "INVALID_REQUEST");
  if (key === undefined) return submitted;
  if (current !== undefined && (current === null || typeof current !== "object" || Array.isArray(current) !== Array.isArray(submitted)))
    throw new HttpError(400, `Cannot change the parent of submitted field ${pointer}`, "INVALID_REQUEST");

  const changed = replace(field(current, key), field(submitted, key), rest, pointer);
  if (Array.isArray(submitted)) {
    const array = Array.isArray(current) ? [...current] : [];
    const index = Number(key);
    if (index > array.length) throw new HttpError(400, `Invalid array index in submitted field ${pointer}`, "INVALID_REQUEST");
    array[index] = changed;
    return array;
  }
  const object = current !== null && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...object, [key]: changed };
}

export function applySubmittedFields(current: PanelFormValues, values: PanelFormValues, submittedFields: readonly string[]): PanelFormValues {
  let result = current;
  for (const pointer of submittedFields) {
    const [key, ...rest] = pointer.slice(1).split("/").map(token => token.replaceAll("~1", "/").replaceAll("~0", "~"));
    result = { ...result, [key]: replace(field(result, key), field(values, key), rest, pointer) };
  }
  return result;
}
