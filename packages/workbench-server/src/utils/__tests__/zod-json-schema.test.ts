import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";

const rawRef = vi.hoisted(() => ({
  zodToJsonSchema: undefined as typeof zodToJsonSchema | undefined,
}));

vi.mock("zod-to-json-schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zod-to-json-schema")>();
  rawRef.zodToJsonSchema = actual.zodToJsonSchema;
  return {
    ...actual,
    zodToJsonSchema: vi.fn(actual.zodToJsonSchema),
  };
});

import {
  cachedZodToJsonSchema, cachedZodToJsonSchemaString, cachedZodToRuntimeJsonSchema,
} from "../zod-json-schema";

const zodToJsonSchemaSpy = vi.mocked(zodToJsonSchema);

describe("cachedZodToJsonSchema", () => {
  beforeEach(() => {
    zodToJsonSchemaSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    zodToJsonSchemaSpy.mockClear();
  });

  it("converts a static schema once and reuses the cached result across helpers", () => {
    const schema = z.object({
      name: z.string().min(1),
      tags: z.array(z.string()),
    }).strict();

    const first = cachedZodToJsonSchema(schema, { effectStrategy: "input" });
    const second = cachedZodToJsonSchema(schema, { effectStrategy: "input" });
    const runtime = cachedZodToRuntimeJsonSchema(schema, { effectStrategy: "input" });
    const serialized = cachedZodToJsonSchemaString(schema, { effectStrategy: "input" });

    expect(zodToJsonSchemaSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(runtime).toEqual(first);
    expect(JSON.parse(serialized)).toEqual(first);
    expect(first).toEqual(rawRef.zodToJsonSchema!(schema, { effectStrategy: "input" }));
  });

  it("separates cache entries by conversion options for the same schema", () => {
    const schema = z.object({
      count: z.string().transform(value => Number(value)),
    }).strict();

    const inputMode = cachedZodToJsonSchema(schema, { effectStrategy: "input" });
    const defaultMode = cachedZodToJsonSchema(schema);
    const noRefMode = cachedZodToJsonSchema(schema, { $refStrategy: "none" });

    expect(zodToJsonSchemaSpy).toHaveBeenCalledTimes(3);
    expect(inputMode).toEqual(rawRef.zodToJsonSchema!(schema, { effectStrategy: "input" }));
    expect(defaultMode).toEqual(rawRef.zodToJsonSchema!(schema));
    expect(noRefMode).toEqual(rawRef.zodToJsonSchema!(schema, { $refStrategy: "none" }));

    expect(cachedZodToJsonSchema(schema, { effectStrategy: "input" })).toBe(inputMode);
    expect(cachedZodToJsonSchema(schema)).toBe(defaultMode);
    expect(cachedZodToJsonSchema(schema, { $refStrategy: "none" })).toBe(noRefMode);
    expect(zodToJsonSchemaSpy).toHaveBeenCalledTimes(3);
  });

  it("deeply freezes cached schemas so callers cannot mutate shared state", () => {
    const schema = z.object({
      nested: z.object({ flag: z.boolean() }).strict(),
    }).strict();

    const json = cachedZodToJsonSchema(schema) as Record<string, unknown>;
    const runtime = cachedZodToRuntimeJsonSchema(schema);

    expect(Object.isFrozen(json)).toBe(true);
    expect(Object.isFrozen((json.properties as Record<string, unknown>).nested)).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(() => {
      (json as Record<string, unknown>).title = "mutated";
    }).toThrow(TypeError);
    expect(() => {
      ((runtime.properties as Record<string, Record<string, unknown>>).nested).type = "string";
    }).toThrow(TypeError);
  });

  it("matches raw output on recursive form schemas without emitting console warnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cached = cachedZodToJsonSchema(panelFormSaveInputSchema, { $refStrategy: "none" });
    const cachedSecond = cachedZodToJsonSchema(panelFormSaveInputSchema, { $refStrategy: "none" });
    const cachedString = cachedZodToJsonSchemaString(panelFormSaveInputSchema, { $refStrategy: "none" });

    expect(cachedSecond).toBe(cached);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(zodToJsonSchemaSpy).toHaveBeenCalledTimes(1);

    const raw = rawRef.zodToJsonSchema!(panelFormSaveInputSchema, { $refStrategy: "none" });
    expect(warnSpy).toHaveBeenCalled();
    expect(cached).toEqual(raw);
    expect(cachedString).toBe(JSON.stringify(raw));
  });
});
