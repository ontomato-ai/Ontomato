import type { z, ZodError } from "zod";
import type { currentProductRecord } from "../../infrastructure/product-current";
import { HttpError } from "../../utils/errors";

export function panelDefinitionProblem(error: ZodError, subject = "Panel definition"): string {
  const unknownFields = error.issues.flatMap(issue => issue.code === "unrecognized_keys"
    ? issue.keys.map(key => [...issue.path, key].join(".")) : []);
  if (unknownFields.length) {
    const missing = error.issues.flatMap(issue => issue.code === "invalid_type" && issue.received === "undefined"
      ? [`Field '${issue.path.join(".")}' is required.`] : []);
    return [...unknownFields.map(field => `Unrecognized field '${field}'.`), ...missing].join(" ");
  }
  const issue = error.issues[0]!;
  const field = issue.path.length ? `Field '${issue.path.join(".")}'` : subject;
  return issue.code === "invalid_type" && issue.received === "undefined"
    ? `${field} is required.` : `${field} does not match the current panel contract.`;
}

export function parseStoredDefinition<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>, record: ReturnType<typeof currentProductRecord>, kind: "Panel" | "Projection",
): T {
  const parsed = schema.safeParse(record);
  if (!parsed.success)
    throw new HttpError(422, `${kind} '${record.id}': ${panelDefinitionProblem(parsed.error, `${kind} definition`)}`, "PRODUCT_DEFINITION_INVALID");
  return parsed.data;
}
