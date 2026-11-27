import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AGENT_DEFINITION, isPlatformFormSaveOperation, platformFormSaveOperations, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

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

vi.mock("../../assistant/skills", () => ({}));

import {
  describeServerOperation, operationDeclaration, registeredPanelOperation,
} from "../server-operations";
import { operationHost } from "../operation-host";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const zodToJsonSchemaSpy = vi.mocked(zodToJsonSchema);

describe("server-operations schema caching", () => {
  beforeEach(() => {
    zodToJsonSchemaSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    zodToJsonSchemaSpy.mockClear();
  });

  it("caches operation declarations and descriptions without altering JSON Schema output", async () => {
    const operationId = `${AGENT_DEFINITION}.save`;
    const first = registeredPanelOperation(operationId);
    expect(first).toBeDefined();
    const expectedInputSchema = rawRef.zodToJsonSchema!(first!.handler.inputSchema, { effectStrategy: "input" });
    const expectedResultSchema = rawRef.zodToJsonSchema!(first!.handler.resultSchema, { effectStrategy: "input" });

    zodToJsonSchemaSpy.mockClear();

    const second = registeredPanelOperation(operationId);
    const third = operationDeclaration(first!.handler);
    expect(second?.declaration).toBe(first!.declaration);
    expect(third).toBe(first!.declaration);
    expect(first!.declaration.inputSchema).toEqual(expectedInputSchema);
    expect(zodToJsonSchemaSpy).not.toHaveBeenCalled();

    const host = operationHost({ owner: { domainId: "d", userId: "reader" }, credentials: { locale: "en" } });
    const firstDescription = await describeServerOperation(first!.handler, host.locale, "editor");
    const callsAfterFirstDescribe = zodToJsonSchemaSpy.mock.calls.length;
    const secondDescription = await describeServerOperation(first!.handler, host.locale, "editor");

    expect(callsAfterFirstDescribe).toBeLessThanOrEqual(1);
    expect(zodToJsonSchemaSpy).toHaveBeenCalledTimes(callsAfterFirstDescribe);
    expect(firstDescription.resultSchema).toEqual(expectedResultSchema);
    expect(secondDescription).toEqual(firstDescription);
  });

  it("matches platformFormSaveOperations 1-to-1 with registered form.save server operations", () => {
    const declaredOps = Object.values(platformObjectTypes).flatMap(entry => entry.operations ?? []);
    const registeredSaves = declaredOps.filter(id => registeredPanelOperation(id)?.handler.kind === "form.save");
    expect(registeredSaves.length).toBeGreaterThan(0);
    expect(new Set(registeredSaves)).toEqual(platformFormSaveOperations);
    for (const id of declaredOps) {
      const reg = registeredPanelOperation(id);
      if (reg) expect(reg.handler.kind === "form.save").toBe(isPlatformFormSaveOperation(id));
    }
  });
});
