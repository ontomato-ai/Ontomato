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
it('requires a host-transport SDK for new source publications while accepting its installed version',async()=>{
  const {requireHostedSdkTransport}=await import('../hosted-apps');
  const files=[{path:'index.html',encoding:'utf8' as const,content:'<script type="module" src="/apps-sdk/1.2.0/sdk.js"></script>'}];
  await expect(requireHostedSdkTransport(files,async()=>({hostTransport:1,messageBridge:2}))).resolves.toBeUndefined();
  await expect(requireHostedSdkTransport(files,async()=>({}))).rejects.toMatchObject({code:'PRODUCT_SDK_UPGRADE_REQUIRED'});
  await expect(requireHostedSdkTransport(files,async()=>({hostTransport:1}))).rejects.toMatchObject({code:'PRODUCT_SDK_UPGRADE_REQUIRED'});
  await expect(requireHostedSdkTransport([],async()=>({hostTransport:1}))).rejects.toMatchObject({code:'PRODUCT_SDK_UPGRADE_REQUIRED'});
});
it('prevents retry or rollback from reactivating an unsandboxed historical release',async()=>{
  const {requireHostedReleasePolicy}=await import('../hosted-apps');
  await expect(requireHostedReleasePolicy('app-example','release',async()=>({hostTransport:1,messageBridge:2}))).resolves.toBeUndefined();
  for(const policy of [{},{hostTransport:1},{messageBridge:2}])await expect(requireHostedReleasePolicy('app-example','release',async()=>policy)).rejects.toMatchObject({code:'PRODUCT_SDK_UPGRADE_REQUIRED'});
  await expect(requireHostedReleasePolicy('app-example','release',async()=>{throw Object.assign(new Error('Missing'),{code:'ENOENT'});})).rejects.toMatchObject({code:'PRODUCT_SDK_UPGRADE_REQUIRED'});
});
