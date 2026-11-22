import type { z } from "zod";
import {
  ignoreOverride, zodToJsonSchema, type JsonSchema7Type, type Options, type OverrideCallback,
} from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";

export type CachedZodJsonSchemaOptions = Pick<Partial<Options<"jsonSchema7">>, "$refStrategy" | "effectStrategy" | "target">;
export type CachedZodJsonSchema = ReturnType<typeof zodToJsonSchema<"jsonSchema7">>;
export type CachedRuntimeJsonObject = z.infer<typeof runtimeJsonObjectSchema>;

interface CachedSchemaEntry {
  json: CachedZodJsonSchema;
  runtime?: CachedRuntimeJsonObject;
  serialized?: string;
}

const schemaCache = new WeakMap<z.ZodTypeAny, Map<string, CachedSchemaEntry>>();

/**
 * Matches zod-to-json-schema's built-in recursive fallback (`{}` for non-openAi targets under `$refStrategy: "none"` or
 * `"seen"`) without emitting synchronous `console.warn` lines on every recursive branch.
 */
const silentRecursiveAny: OverrideCallback = (_def, refs, seen, forceResolution) => {
  if (
    seen
    && !forceResolution
    && refs.target !== "openAi"
    && (refs.$refStrategy === "none" || refs.$refStrategy === "seen")
    && seen.path.length < refs.currentPath.length
    && seen.path.every((segment, index) => refs.currentPath[index] === segment)
  ) {
    return {} as JsonSchema7Type;
  }
  return ignoreOverride;
};

/** Recursively freeze a plain JSON object/array tree so callers cannot mutate shared cached structures. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function optionKey(options?: CachedZodJsonSchemaOptions): string {
  return `${options?.$refStrategy ?? ""}|${options?.effectStrategy ?? ""}|${options?.target ?? ""}`;
}

function getOrCreateEntry(schema: z.ZodTypeAny, options?: CachedZodJsonSchemaOptions): CachedSchemaEntry {
  let byOptions = schemaCache.get(schema);
  if (!byOptions) {
    byOptions = new Map();
    schemaCache.set(schema, byOptions);
  }
  const key = optionKey(options);
  const cached = byOptions.get(key);
  if (cached) return cached;

  const suppressRecursiveWarn = options?.$refStrategy === "none" || options?.$refStrategy === "seen";
  const converted = zodToJsonSchema(
    schema,
    suppressRecursiveWarn ? { ...options, override: silentRecursiveAny } : options,
  );
  const entry: CachedSchemaEntry = { json: deepFreeze(converted) };
  byOptions.set(key, entry);
  return entry;
}

/** Convert a Zod schema to JSON Schema once per `(schema, options)` and return a deeply frozen cached object. */
export function cachedZodToJsonSchema(
  schema: z.ZodTypeAny,
  options?: CachedZodJsonSchemaOptions,
): CachedZodJsonSchema {
  return getOrCreateEntry(schema, options).json;
}

/** Convert a Zod schema to a validated `RuntimeJsonObject` once per `(schema, options)` and return it deeply frozen. */
export function cachedZodToRuntimeJsonSchema(
  schema: z.ZodTypeAny,
  options?: CachedZodJsonSchemaOptions,
): CachedRuntimeJsonObject {
  const entry = getOrCreateEntry(schema, options);
  entry.runtime ??= deepFreeze(runtimeJsonObjectSchema.parse(entry.json));
  return entry.runtime;
}

/** Convert a Zod schema to a JSON Schema string once per `(schema, options)` and cache the serialized string. */
export function cachedZodToJsonSchemaString(
  schema: z.ZodTypeAny,
  options?: CachedZodJsonSchemaOptions,
): string {
  const entry = getOrCreateEntry(schema, options);
  entry.serialized ??= JSON.stringify(entry.json);
  return entry.serialized;
}
