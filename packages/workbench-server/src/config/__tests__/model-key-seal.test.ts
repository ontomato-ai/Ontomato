import { afterEach, expect, it, vi } from "vitest";
import { modelKeySealKey, openSealedModelKey } from "../model-key-seal";

// Sealed by Java's ModelKeySeal for this token; the data engine's BusinessConfigControllerModelKeyWriteOnlyTest pins the
// same value, so the two implementations cannot drift apart.
const FIXTURE_TOKEN = "fixture-runtime-token";
const FIXTURE_SEALED = "enc:v1:mzjUpW4OVVjLMPmxcmMcyop5LFN8VSJ_7lUGPppYXDK_UDNjyKAlYAL7vVwOMOI";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("opens a key Java sealed with the same token, and nothing else", () => {
  vi.stubEnv("ONTOMATO_MODEL_RUNTIME_TOKEN", FIXTURE_TOKEN);
  expect(openSealedModelKey(FIXTURE_SEALED)).toBe("sk-fixture-key-1234");
  expect(() => openSealedModelKey("******1234")).toThrow("not sealed");

  vi.stubEnv("ONTOMATO_MODEL_RUNTIME_TOKEN", "another-token");
  expect(() => openSealedModelKey(FIXTURE_SEALED)).toThrow();
});

it.each(["", " \t "])("a missing or blank token (%j) is refused, which stops startup", (value) => {
  vi.stubEnv("ONTOMATO_MODEL_RUNTIME_TOKEN", value);
  expect(() => modelKeySealKey()).toThrow("ONTOMATO_MODEL_RUNTIME_TOKEN is not set");
});
