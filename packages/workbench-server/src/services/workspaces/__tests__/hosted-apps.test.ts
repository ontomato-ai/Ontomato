import { afterEach, expect, it, vi } from "vitest";
import { writeHostedPublication } from "../hosted-apps";
vi.mock("../../../config/data-query-api", () => ({ getApiConfig: () => ({}), buildUrl: (_config: unknown, route: string) => `http://java.test${route}` }));
vi.mock("../../../logging/logger", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));
afterEach(() => { vi.unstubAllGlobals(); });
it.each([{ token: "current-token" }, { apiKey: "current-api-key" }])("sends the reviewed PUT contract using the current caller credential: %j", async credentials => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { id: "app-test" } }), { status: 200 }));
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
