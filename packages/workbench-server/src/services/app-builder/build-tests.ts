import path from "node:path";
import { z } from "zod";
import { buildTestContextSchema, BUILD_TEST_SDK_CAPABILITY, BUILD_TEST_SAMPLE_DIRECTORY } from "@ontomato/contracts/build-tests";
import { workspacePathSchema } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { backendGet, backendPost, backendDelete, BackendResponseError, AuthFailedError } from "../../utils/backend-client";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import type { AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { runtimeDataDir } from "../../content/layout";
import { readFile } from "node:fs/promises";
import { currentAppSdk } from "./sdk";

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
    try {
      const response = method === "GET" ? await backendGet("build-tests", url, options)
        : method === "DELETE" ? await backendDelete("build-tests", url, options) : await backendPost("build-tests", url, body, options);
      const json = JSON.parse(response.text);
      return json === null ? null : buildTestContextSchema.parse(json);
    } catch (error) {
      if (error instanceof BackendResponseError || error instanceof AuthFailedError) {
        let detail: {message?:string;code?:string};
        try { detail=JSON.parse(error.detail || "{}"); } catch { detail={message:error.detail}; }
        throw new HttpError(error.status ?? 401, detail.message ?? error.message, detail.code);
      }
      throw error;
    }
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
    const files=tree.files.filter(file=>/\.(?:html|m?js|ts|vue|json)$/i.test(file.path) && !file.path.startsWith(BUILD_TEST_SAMPLE_DIRECTORY+"/"));
    const sources=await Promise.all(files.map(async file=>(await this.runtime.bytes(`/v1/workspaces/${this.workspaceId}/files/content?${new URLSearchParams({path:file.path})}`)).toString("utf8")));
    const code=sources.join("\n");
    const versions = [...new Set([...code.matchAll(/\/apps-sdk\/([a-zA-Z0-9.-]+)\//g)].map(match => match[1]!))];
    if (!versions.length && !code.includes("@ontomato/sdk")) return; // Static pages have no SDK business client.
    let supported = versions.length > 0;
    for (const version of versions) {
      const manifest = await readFile(runtimeDataDir("apps-sdk", version, "sdk.json"), "utf8").then(JSON.parse).catch(() => null);
      supported &&= manifest?.executionContext === BUILD_TEST_SDK_CAPABILITY;
    }
    if (!supported) throw new HttpError(409, `Upgrade the workspace SDK to ${(await currentAppSdk()).version} for build-test preview`, "BUILD_TEST_SDK_UPGRADE_REQUIRED");
  }
}
