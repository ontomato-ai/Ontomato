import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";

/*
 * An owner form's values are its own JSON — nested objects, arrays, `false` and `null` as they are — and its fields name
 * their place in it by JSON Pointer (`/modelSelection/modelId`). These read and replace one value by its pointer without
 * changing anything else, so a form and the projections that edit one of its fields hold one value, never a copy.
 */

function tokens(path: string): string[] {
  return path.split("/").slice(1).map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The value a pointer names; undefined when the values do not reach it. */
export function valueAt(values: PanelFormValues, path: string): RuntimeJsonValue | undefined {
  let current: RuntimeJsonValue | undefined = values;
  for (const token of tokens(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current) ? current[Number(token)] : current[token];
  }
  return current;
}

/** The values with the one a pointer names replaced; objects along the way are created where the values had none. */
export function withValueAt(values: PanelFormValues, path: string, value: RuntimeJsonValue): PanelFormValues {
  const replace = (node: RuntimeJsonValue | undefined, [token, ...rest]: string[]): RuntimeJsonValue => {
    if (token === undefined) return value;
    if (Array.isArray(node)) return node.map((item, index) => (index === Number(token) ? replace(item, rest) : item));
    const object = node !== null && typeof node === "object" ? node : {};
    return { ...object, [token]: replace(object[token], rest) };
  };
  return replace(values, tokens(path)) as PanelFormValues;
}

/** The values with the one a pointer names left out: the key goes from the object that holds it. */
export function withoutValueAt(values: PanelFormValues, path: string): PanelFormValues {
  const drop = (node: RuntimeJsonValue | undefined, [token, ...rest]: string[]): RuntimeJsonValue | undefined => {
    if (token === undefined || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item, index) => (index === Number(token) ? drop(item, rest)! : item));
    if (!rest.length) return Object.fromEntries(Object.entries(node).filter(([key]) => key !== token));
    return Object.hasOwn(node, token) ? { ...node, [token]: drop(node[token], rest)! } : node;
  };
  return drop(values, tokens(path)) as PanelFormValues;
}

/** The fields whose value differs between two readings of one form, by path: what a draft changed. */
export function changedPaths(
  fields: readonly PanelFormField[],
  before: PanelFormValues,
  after: PanelFormValues,
): ReadonlySet<string> {
  return new Set(
    fields
      .filter((field) => JSON.stringify(valueAt(before, field.path)) !== JSON.stringify(valueAt(after, field.path)))
      .map((field) => field.path),
  );
}

/**
 * The owner's description of the field an absolute pointer names, through objects and array rows: a row field's path is
 * relative to its row, so `/parameters/2/name` is the `/name` item field of the `/parameters` array. Undefined when the
 * description names no such field.
 */
export function fieldAt(fields: readonly PanelFormField[], path: string, base = ""): PanelFormField | undefined {
  for (const field of fields) {
    const at = base + field.path;
    if (path === at) return field;
    if (!path.startsWith(`${at}/`)) continue;
    const { control } = field;
    if (control.kind === "object") return fieldAt(control.fields, path, at);
    if (control.kind === "object-array") return fieldAt(control.itemFields, path, `${at}/${path.slice(at.length + 1).split("/")[0]}`);
  }
  return undefined;
}

/**
 * A path after the rows of the array at `arrayPath` were rearranged, `order[next] = previous`: a path inside a row that
 * moved follows it to its new index, one inside a removed row is gone (null), and any other path is unchanged.
 */
export function movedPath(path: string, arrayPath: string, order: readonly number[]): string | null {
  if (!path.startsWith(`${arrayPath}/`)) return path;
  const [index, ...rest] = path.slice(arrayPath.length + 1).split("/");
  const next = order.indexOf(Number(index));
  return next < 0 ? null : [`${arrayPath}/${next}`, ...rest].join("/");
}

/** Whether an owner's JSON Schema for a value admits null: `type` naming it, or one of `anyOf`/`oneOf` that does. */
export function admitsNull(schema: Readonly<Record<string, unknown>>): boolean {
  const type = schema.type;
  if (type === "null" || (Array.isArray(type) && type.includes("null"))) return true;
  const options = [schema.anyOf, schema.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
  return options.some((option) => option !== null && typeof option === "object" && admitsNull(option as Record<string, unknown>));
}
