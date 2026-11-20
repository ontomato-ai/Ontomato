import path from "node:path";
import { z } from "zod";
import { buildTestContextSchema, type BuildTestSdkUpgradeDetails, BUILD_TEST_SDK_CAPABILITY, BUILD_TEST_SAMPLE_DIRECTORY } from "@ontomato/contracts/build-tests";
import { workspacePathSchema } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { backendGet, backendPost, backendDelete } from "../../utils/backend-client";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { HOSTED_SDK_MARKER, SDK_ASSET_PATH } from "../workspaces/hosted-sdk";
import { readCurrentAppSdkRelease } from "./sdk";

function sampleFilePath(file: string) {
  const value=workspacePathSchema.safeParse(file);
  if(!value.success) throw new HttpError(400,`Invalid sample file path: ${file}`,"BUILD_TEST_SAMPLE_INVALID");
  return value.data;
}
/** Node owns workspace access and bytes; Java owns context state and all execution decisions. */
export class WorkspaceBuildTests {
  readonly runtime: RuntimeClient;
  constructor(readonly owner: AssistantOwner, readonly credentials: AssistantCredentials, readonly workspaceId: string) {
    this.runtime = new RuntimeClient(owner.domainId, undefined, owner.userId);
  }
  async authorize() { await this.runtime.request(`/v1/workspaces/${this.workspaceId}`); }
  async java(method: "GET" | "POST" | "DELETE", suffix: string, body?: FormData) {
    const url = buildUrl(getApiConfig(), "/ontology/build-tests" + suffix);
    const options = { ...this.credentials, retries: 1, errorDetailLimit: 4096 };
    const response = method === "GET" ? await backendGet("build-tests", url, options)
      : method === "DELETE" ? await backendDelete("build-tests", url, options) : await backendPost("build-tests", url, body, options);
    const json = JSON.parse(response.text);
    return json === null ? null : buildTestContextSchema.parse(json);
  }
  async current() { await this.authorize(); return this.java("GET", `/current?${new URLSearchParams({ workspaceId: this.workspaceId })}`); }
  async stop() { const current = await this.current(); return current ? this.java("DELETE", `/${current.contextId}`) : null; }
  async start(samplePath = "test-data/sample.json") {
    await this.authorize();
    const read = async (file: string) => {
      try { return await this.runtime.bytes(`/v1/workspaces/${this.workspaceId}/files/content?${new URLSearchParams({ path: sampleFilePath(file) })}`); }
      catch(error) { if(error instanceof HttpError && error.status===404) throw new HttpError(400,`Missing sample file: ${file}`,"BUILD_TEST_SAMPLE_INVALID");throw error; }
    };
    samplePath=sampleFilePath(samplePath);
    if(!samplePath.startsWith(BUILD_TEST_SAMPLE_DIRECTORY+"/")) throw new HttpError(400,"Samples must be inside test-data/ so publication can exclude them","BUILD_TEST_SAMPLE_INVALID");
    const bytes = await read(samplePath);
    const parseSample = () => z.object({ vectorDatas: z.array(z.object({ file: z.string().optional() }).passthrough()) }).passthrough().parse(JSON.parse(bytes.toString("utf8")));
    let sample: ReturnType<typeof parseSample>;
    try {sample=parseSample();} catch(error) {throw new HttpError(400,String(error),"BUILD_TEST_SAMPLE_INVALID");}
    const form = new FormData(); form.set("workspaceId", this.workspaceId);form.set("sampleName",samplePath);
    form.set("sample", new Blob([new Uint8Array(bytes)], { type: "application/json" }));
    for (const file of new Set(sample.vectorDatas.flatMap(row => row.file ? [row.file] : []))) {
      sampleFilePath(file);
      const attachment = await read(path.posix.join(path.posix.dirname(samplePath), file));
      form.set(file, new Blob([new Uint8Array(attachment)]), path.posix.basename(file));
    }
    return this.java("POST", "", form);
  }
  async requirePreviewSdk() {
    await this.authorize();
    const tree=z.object({files:z.array(z.object({path:workspacePathSchema}))}).parse(await this.runtime.request(`/v1/workspaces/${this.workspaceId}/tree`));
    const files=tree.files.filter(file=>/\.(?:html|[cm]?js|tsx?|vue|css|json)$/i.test(file.path) && !file.path.startsWith(BUILD_TEST_SAMPLE_DIRECTORY+"/"));
    const sources=await Promise.all(files.map(async file=>(await this.runtime.bytes(`/v1/workspaces/${this.workspaceId}/files/content?${new URLSearchParams({path:file.path})}`)).toString("utf8")));
    const code=sources.join("\n");
    const versions = [...new Set([...code.matchAll(SDK_ASSET_PATH)].map(match => match[1]!))];
    const marked = code.includes(HOSTED_SDK_MARKER);
    if (!marked && !versions.length && !code.includes("@ontomato/sdk")) return;
    const sdk = await readCurrentAppSdkRelease();
    if (!marked || versions.length || sdk.manifest.executionContext !== BUILD_TEST_SDK_CAPABILITY) {
      const details:BuildTestSdkUpgradeDetails={
        requiredVersion:sdk.build.version,
        foundVersions:versions,
        upgrade:{kind:"edit-workspace-references",currentCommand:"sdk current",readCommands:["sdk read sdk.json","sdk read docs/index.md","sdk read docs/reference.md"],
          steps:["Read the current SDK version","Use the SDK marker in HTML and import public SDK module names","Read the current SDK interface documentation and adapt changed interfaces","Commit the workspace changes"]},
      };
      throw new HttpError(409,"Upgrade the workspace SDK references before previewing","BUILD_TEST_SDK_UPGRADE_REQUIRED",details);
    }
    return sdk;
  }
}
