/** Preserve string identities and validate the parameter types declared by the data engine. */
export function parseActionValue(value: unknown, type: string): unknown {
  const normalized = type.replace(/^TYPE_/, "").toLowerCase();
  if (["string", "time", "varchar", "text", ""].includes(normalized)) return value;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (["number", "int", "integer", "long", "double", "float"].includes(normalized)) {
    if (typeof parsed !== "number" || !Number.isFinite(parsed)) throw new Error("Expected a number");
  } else if (normalized === "boolean") {
    if (typeof parsed !== "boolean") throw new Error("Expected a boolean");
  } else if (normalized.endsWith("_array") || ["array", "dataset"].includes(normalized)) {
    if (!Array.isArray(parsed)) throw new Error("Expected an array");
    if (normalized === "number_array" && parsed.some(item => typeof item !== "number" || !Number.isFinite(item))) throw new Error("Expected numeric elements");
    if (["string_array", "time_array"].includes(normalized) && parsed.some(item => typeof item !== "string")) throw new Error("Expected string elements");
  } else if (["ontoobj", "object", "vector"].includes(normalized)) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
  }
  return parsed;
}
