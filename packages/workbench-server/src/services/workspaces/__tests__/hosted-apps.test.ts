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

it("excludes test materials from actual release files while preserving workspace source",async()=>{
  const {mkdtemp,readFile,rm}=await import("node:fs/promises");
  const {tmpdir}=await import("node:os");const {join}=await import("node:path");
  const {writeHostedFiles}=await import("../hosted-apps");
  const files=[{path:"index.html",encoding:"utf8" as const,content:"<p>application</p>"},
    {path:"test-data/sample.json",encoding:"utf8" as const,content:"sample-source"},
    {path:"test-data/files/example.txt",encoding:"utf8" as const,content:"attachment-source"}];
  const root=await mkdtemp(join(tmpdir(),"release-exclusion-"));
  try {
    await writeHostedFiles(files,root);expect(await readFile(join(root,"index.html"),"utf8")).toBe("<p>application</p>");
    await expect(readFile(join(root,"test-data/sample.json"))).rejects.toMatchObject({code:"ENOENT"});
    await expect(readFile(join(root,"test-data/files/example.txt"))).rejects.toMatchObject({code:"ENOENT"});
    expect(JSON.parse(await readFile(join(root,'ontomato.product-review.json'),'utf8'))).toMatchObject({schemaVersion:2,generated:true,files:[{path:'index.html',hash:expect.any(String)}]});
    expect(files).toHaveLength(3);expect(files[1]!.content).toBe("sample-source");
  } finally {await rm(root,{recursive:true,force:true});}
});
const sdk = {
  sdkBasePath: "/deployment/apps-sdk/current",
  manifest: {
    entries: { "@ontomato/sdk": "sdk.js" },
    stylesheet: "styles/sdk.css",
    hostTransport: 1,
    messageBridge: 2,
  },
};
const source = '<head><!-- ontomato:apps-sdk --><script type="module" src="./app.js"></script></head>';
const html = (content: string) => ({ path: "index.html", encoding: "utf8" as const, content });

it("injects the current import map and stylesheet before the authored module and validates the result", async () => {
  const { injectHostedSdkHtml, requireHostedSdkTransport } = await import("../hosted-sdk");
  const published = injectHostedSdkHtml(source, sdk);
  expect(published).toContain('href="/deployment/apps-sdk/current/styles/sdk.css"');
  expect(published).toContain('"@ontomato/sdk":"/deployment/apps-sdk/current/sdk.js"');
  expect(published.indexOf('type="importmap"')).toBeLessThan(published.indexOf('type="module"'));
  expect(() => requireHostedSdkTransport([html(published)], sdk)).not.toThrow();
  const next = { ...sdk, manifest: { ...sdk.manifest, entries: { ...sdk.manifest.entries, "vue": "vue.js" } } };
  expect(() => requireHostedSdkTransport([html(published)], next)).not.toThrow();
});

it("rejects old or hand-written SDK paths before publication and reactivation", async () => {
  const { injectHostedSdkHtml, requireHostedSdkTransport } = await import("../hosted-sdk");
  const legacy = '<script type="module" src="/apps-sdk/1.2.0/sdk.js"></script>';
  expect(() => injectHostedSdkHtml(source + legacy, sdk)).toThrow();
  expect(() => requireHostedSdkTransport([html(legacy)], sdk)).toThrow();
  const published = injectHostedSdkHtml(source, sdk);
  expect(() => requireHostedSdkTransport([html(published.replace("/current/", "/1.2.0/"))], sdk)).toThrow();
  expect(() => requireHostedSdkTransport([html(published)], { ...sdk, manifest: { ...sdk.manifest, messageBridge: 1 } })).toThrow();
  expect(() => requireHostedSdkTransport([], sdk)).toThrow();
});
