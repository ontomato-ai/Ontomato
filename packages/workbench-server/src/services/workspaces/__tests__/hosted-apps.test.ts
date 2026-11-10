import { afterEach, expect, it, vi } from "vitest";
import { writeHostedPublication } from "../hosted-apps";
vi.mock("../../../config/data-query-api", () => ({ getApiConfig: () => ({}), buildUrl: (_config: unknown, route: string) => `http://java.test${route}` }));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it.each([{ token: "current-token" }, { apiKey: "current-api-key" }])("sends the reviewed PUT contract using the current caller credential: %j", async credentials => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 200, message: null, success: true, data: { applicationId: "app-test" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const declaration = { name: { en: "Demo" } };
  await writeHostedPublication("app-test", "release-test", declaration, { ...credentials, locale: "en" });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, NonNullable<Parameters<typeof globalThis.fetch>[1]>];
  expect(url).toBe("http://java.test/platform/applications/app-test/hosted-publication");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body as string)).toEqual({ declaration, releaseId: "release-test" });
  const headers = new Headers(init.headers);
  expect(headers.get("tk")).toBe("token" in credentials ? credentials.token : null);
  expect(headers.get("X-API-Key")).toBe("apiKey" in credentials ? credentials.apiKey : null);
  expect(headers.has("Idempotency-Key")).toBe(false);
});
it("exposes a Java rejection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, message: "Wrong domain" }), { status: 200 })));
  await expect(writeHostedPublication("app-test", "release-test", {}, { token: "current", locale: "en" })).rejects.toThrow("Wrong domain");
});

it("reuses identical SDK content and rejects a different payload at the same version", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { assertSameSdk } = await import("../hosted-apps");
  const root = await mkdtemp(join(tmpdir(), "sdk-install-"));
  try {
    const shipped = join(root, "shipped");
    const installed = join(root, "installed");
    for (const dir of [shipped, installed]) {
      await mkdir(dir);
      await writeFile(join(dir, "sdk.js"), "export const sdk = 1;");
      await writeFile(join(dir, "sdk.json"), JSON.stringify({ version: "1.0.0" }));
    }
    await writeFile(join(installed, "sdk.json"), JSON.stringify({ version: "1.0.0", sources: [{ revision: "old" }], productVersion: "old" }));
    await expect(assertSameSdk(shipped, installed, "1.0.0")).resolves.toBeUndefined();
    await writeFile(join(shipped, "sdk.js"), "export const sdk = 2;");
    await expect(assertSameSdk(shipped, installed, "1.0.0")).rejects.toThrow("version conflict: 1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
