import { z } from "zod";

const nonBlank = z.string().refine(text => text.trim().length > 0, "Expected a nonblank name");
const names = z.record(nonBlank).refine(
  value => Object.keys(value).length > 0,
  "At least one localized name is required",
);
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);

/** Pick the reader's locale, falling back to its base language, English, then any nonblank translation. */
export function localizedApplicationText(
  texts: Record<string, string> | undefined,
  locale?: string,
): string | undefined {
  if (!texts) return undefined;
  const base = locale?.split("-")[0];
  for (const tag of [locale, base, "en"]) {
    if (!tag) continue;
    const value = texts[tag];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  for (const value of Object.values(texts)) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Java-owned application metadata, shared by source and panel registration requests. */
export const applicationMetadataSchema = z.object({
  names,
  descriptions: z.record(z.string()),
  icon: z.string().min(1),
  groups: z.array(z.object({ key, names, sort: z.number().int() }).strict()),
  permissions: z.array(z.object({ code: key, names, groupKey: key, sort: z.number().int() }).strict()),
}).strict();
