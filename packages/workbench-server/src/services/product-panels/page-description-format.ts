export function inputLinkDescriptions(inputs: Record<string, unknown> | undefined): string[] {
  return Object.entries(inputs ?? {}).flatMap(([input, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as { state?: unknown; field?: unknown; output?: unknown };
    if (typeof record.state === "string") {
      const field = typeof record.field === "string" ? `.${record.field}` : "";
      return [`${input}←${record.state}${field}`];
    }
    const output = record.output;
    if (output && typeof output === "object" && !Array.isArray(output)) {
      const { member, name, path } = output as { member?: unknown; name?: unknown; path?: unknown };
      if (typeof member === "string" && typeof name === "string") {
        return [`${input}←${member}.${name}${typeof path === "string" ? `[${path}]` : ""}`];
      }
    }
    return [];
  });
}

function compactInputSchema(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return JSON.stringify(schema) ?? "unknown";
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum)) return record.enum.map(value => JSON.stringify(value)).join("|");
  if (record.const !== undefined) return JSON.stringify(record.const);
  if (depth >= 3) return typeof record.type === "string" ? record.type : "value";
  if (record.type === "array") return `${compactInputSchema(record.items, depth + 1)}[]`;
  if (record.type === "object" || record.properties) {
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? record.properties as Record<string, unknown>
      : {};
    const required = new Set(Array.isArray(record.required) ? record.required.filter((key): key is string => typeof key === "string") : []);
    const entries = Object.entries(properties);
    if (!entries.length) return "object";
    return `{${entries.map(([key, value]) => `${key}${required.has(key) ? "" : "?"}:${compactInputSchema(value, depth + 1)}`).join(",")}}`;
  }
  if (typeof record.type === "string") return record.type;
  return "value";
}

export function operationInputSuffix(schema: unknown): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return ` Input ${compactInputSchema(schema)}.`;
  const properties = (schema as Record<string, unknown>).properties;
  if ((schema as Record<string, unknown>).type === "object" && (!properties || typeof properties !== "object" || Array.isArray(properties) || !Object.keys(properties).length)) return "";
  return ` Input ${compactInputSchema(schema)}.`;
}
