import { HttpError } from "./errors";

/** Values are nested objects. The leading slash belongs to field paths, never to a top-level value key. */
export function requireFormFieldNames(values: unknown, field: "form" | "values"): void {
  if (values === null || typeof values !== "object") return;
  const key = Object.keys(values).find(name => name.startsWith("/"));
  if (key !== undefined) {
    throw new HttpError(400,
      `Invalid ${field} key ${JSON.stringify(key)}. Use field names and nested JSON without a leading slash in value keys.`,
      "INVALID_REQUEST");
  }
}
