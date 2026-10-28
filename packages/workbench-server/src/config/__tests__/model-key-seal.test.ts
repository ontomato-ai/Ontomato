import { expect, it } from "vitest";
import { modelKeySealKey, openSealedModelKey } from "@ontomato/contracts/model-key-seal";

// Sealed by Java's ModelKeySeal for this token; the data engine's BusinessConfigControllerModelKeyWriteOnlyTest pins the
// same value, so the two implementations cannot drift apart.
const FIXTURE_TOKEN = "fixture-runtime-token";
const FIXTURE_SEALED = "enc:v1:mzjUpW4OVVjLMPmxcmMcyop5LFN8VSJ_7lUGPppYXDK_UDNjyKAlYAL7vVwOMOI";

it("opens a key Java sealed with the same token, and nothing else", () => {
  expect(openSealedModelKey(FIXTURE_SEALED, FIXTURE_TOKEN)).toBe("sk-fixture-key-1234");
  expect(() => openSealedModelKey("******1234", FIXTURE_TOKEN)).toThrow("not sealed");
  expect(() => openSealedModelKey(FIXTURE_SEALED, "another-token")).toThrow();
});

it.each([undefined, "", " \t "])("a missing or blank token (%j) is refused, which stops startup", (value) => {
  expect(() => modelKeySealKey(value)).toThrow("ONTOMATO_MODEL_RUNTIME_TOKEN is not set");
});
