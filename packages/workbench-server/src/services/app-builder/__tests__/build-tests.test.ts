import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WorkspaceBuildTests } from "../build-tests";
import { backendGet, backendPost } from "../../../utils/backend-client";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";

vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:vi.fn()}));
vi.mock("../../../utils/backend-client",async original=>({...await original<typeof import("../../../utils/backend-client")>(),backendGet:vi.fn(),backendPost:vi.fn(),backendDelete:vi.fn()}));
vi.mock("../../../config/data-query-api",()=>({getApiConfig:()=>({}),buildUrl:(_:unknown,url:string)=>"http://java"+url}));
vi.mock("../../../content/layout",()=>({runtimeDataDir:(...parts:string[])=>"/sdk/"+parts.join("/")}));
vi.mock("../sdk",()=>({currentAppSdk:async()=>({version:"1.1.0"})}));
vi.mock("node:fs/promises",()=>({readFile:vi.fn()}));
const fixtures=path.resolve("../data-engine-core/src/test/resources/agent-contracts");
const sample=JSON.parse(readFileSync(path.join(fixtures,"sample.json"),"utf8"));
const authorize=vi.fn(),bytes=vi.fn();
const context={contextId:"context",workspaceId:"workspace",status:"READY",expiresAt:Date.now()+60000,
  classNames:["contract_person","contract_group"],sampleSummary:{classes:2,sha256:"digest"},resources:[]};
beforeEach(()=>{
  vi.clearAllMocks();authorize.mockImplementation(async(url:string)=>url.endsWith("/tree") ? {files:[{path:"index.html"}]} : {id:"workspace"});
  vi.mocked(RuntimeClient).mockImplementation(()=>({request:authorize,bytes}) as unknown as RuntimeClient);
  vi.mocked(backendPost).mockResolvedValue({text:JSON.stringify(context),status:200,statusText:"OK",headers:new Headers()});
  vi.mocked(backendGet).mockResolvedValue({text:"null",status:200,statusText:"OK",headers:new Headers()});
});
it("authorizes the workspace, forwards original attachment bytes and current credentials once",async()=>{
  bytes.mockImplementation(async(url:string)=>{
    const file=new URL("http://runtime"+url).searchParams.get("path")!;
    return file==="test-data/sample.json" ? Buffer.from(JSON.stringify(sample)) : readFileSync(path.join(fixtures,file.replace(/^test-data\//,"")));
  });
  const tests=new WorkspaceBuildTests({userId:"owner",domainId:"domain"},{apiKey:"current-key"},"workspace");
  await tests.start();expect(authorize).toHaveBeenCalledWith("/v1/workspaces/workspace");
  expect(backendPost).toHaveBeenCalledOnce();
  const [,url,body,options]=vi.mocked(backendPost).mock.calls[0]!;
  expect(url).toBe("http://java/ontology/build-tests");expect(options).toMatchObject({apiKey:"current-key",retries:1});
  const form=body as FormData;
  expect(JSON.parse(await (form.get("sample") as Blob).text())).toEqual(sample);
  expect(await (form.get("files/example-1.txt") as Blob).text()).toBe(readFileSync(path.join(fixtures,"files/example-1.txt"),"utf8"));
});
it("does not call Java when workspace access fails",async()=>{
  authorize.mockRejectedValue(new Error("not owned"));
  await expect(new WorkspaceBuildTests({userId:"other",domainId:"domain"},{},"workspace").start()).rejects.toThrow("not owned");
  expect(backendPost).not.toHaveBeenCalled();expect(bytes).not.toHaveBeenCalled();
});
it("returns Java's absent state and rejects old SDK preview references",async()=>{
  const tests=new WorkspaceBuildTests({userId:"owner",domainId:"domain"},{},"workspace");
  expect(await tests.current()).toBeNull();
  bytes.mockResolvedValue(Buffer.from('<script src="/apps-sdk/1.0.0/sdk.js"></script>'));
  vi.mocked(readFile).mockResolvedValue('{"version":"1.0.0"}');
  await expect(tests.requirePreviewSdk()).rejects.toMatchObject({code:"BUILD_TEST_SDK_UPGRADE_REQUIRED"});
  vi.mocked(readFile).mockResolvedValue('{"executionContext":1}');await tests.requirePreviewSdk();
});

it("checks SDK references in separate modules, not just the entry HTML",async()=>{
  authorize.mockImplementation(async(url:string)=>url.endsWith("/tree") ? {files:[{path:"index.html"},{path:"app.js"}]} : {id:"workspace"});
  bytes.mockImplementation(async(url:string)=>Buffer.from(url.includes("app.js") ? 'import "/apps-sdk/1.0.0/sdk.js"' : '<script type="module" src="app.js"></script>'));
  vi.mocked(readFile).mockResolvedValue('{"version":"1.0.0"}');
  await expect(new WorkspaceBuildTests({userId:"owner",domainId:"domain"},{},"workspace").requirePreviewSdk()).rejects.toMatchObject({code:"BUILD_TEST_SDK_UPGRADE_REQUIRED"});
});
