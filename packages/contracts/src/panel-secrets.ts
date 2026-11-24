import { formFieldPointer } from "./form-fields";

export function panelInputPointer(key: string): string {
  return formFieldPointer("/", key);
}

export function normalizePanelSecretPointer(path: string): string {
  return path.startsWith("/") ? path : panelInputPointer(path);
}

export function panelSecretValuePresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function tokens(pointer: string): string[] {
  return pointer.slice(1).split("/").map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function edit(node: unknown, [key, ...rest]: string[], replace: (value: unknown) => unknown): unknown {
  if (key === undefined) return replace(node);
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item, index) => String(index) === key ? edit(item, rest, replace) ?? null : item);
  }
  const record = node as Record<string, unknown>;
  const present = Object.hasOwn(record, key);
  if (!present && rest.length) return node;
  const next = edit(present ? record[key] : undefined, rest, replace);
  if (next !== undefined) return { ...record, [key]: next };
  if (!present) return node;
  const result = { ...record };
  delete result[key];
  return result;
}

/** Split input without shifting array indices or changing the caller's values. */
export function splitPanelSecrets<T extends Record<string, unknown>>(input: T, paths: readonly string[]) {
  const secrets = new Map<string, unknown>();
  let redacted: Record<string, unknown> = input;
  // When declarations overlap, retain each child and restore its parent first.
  for (const path of [...new Set(paths)].sort((a, b) => b.length - a.length)) {
    redacted = edit(redacted, tokens(path), value => {
      if (value !== undefined) secrets.set(path, value);
      return undefined;
    }) as Record<string, unknown>;
  }
  return { redacted: redacted as T, secrets };
}

export function restorePanelSecrets(input: Record<string, unknown>, secrets: ReadonlyMap<string, unknown>) {
  let restored = input;
  for (const [path, value] of [...secrets].reverse()) {
    restored = edit(restored, tokens(path), () => value) as Record<string, unknown>;
  }
  return restored;
}

/** Concrete JSON Schema property paths marked by the operation owner. */
export function panelSchemaSecretPaths(schema: unknown, input?: unknown, base = ""): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const rule = schema as Record<string, unknown>;
  if (base && (rule.format === "password" || rule["x-secret"] === true)) return [base];
  const paths = [rule.anyOf, rule.oneOf, rule.allOf].flatMap(branches => Array.isArray(branches)
    ? branches.flatMap(branch => panelSchemaSecretPaths(branch, input, base)) : []);
  if (rule.properties && typeof rule.properties === "object") {
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
    for (const [key, child] of Object.entries(rule.properties)) {
      paths.push(...panelSchemaSecretPaths(child, Object.hasOwn(record, key) ? record[key] : undefined, base + panelInputPointer(key)));
    }
  }
  if (Array.isArray(input)) {
    input.forEach((item, index) => paths.push(...panelSchemaSecretPaths(rule.items, item, `${base}/${index}`)));
  }
  return paths;
}

export function panelSecretPathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
