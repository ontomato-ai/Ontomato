import path from "node:path";
import { z } from "zod";
import { buildTestContextSchema, BUILD_TEST_SAMPLE_DIRECTORY } from "@ontomato/contracts/build-tests";
import { workspacePathSchema } from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { backendGet, backendPost, backendDelete } from "../../utils/backend-client";
import { environment } from "../../config/environment";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

export async function sessionBuildTestWorkspace(owner: AssistantOwner, sessionId: string) {
  const session = await assistantStore.session(sessionId, owner);
  if (!session.workspace_id) throw new HttpError(422, "Build-test requires the run's workspace", "BUILD_TEST_WORKSPACE_REQUIRED");
  return session.workspace_id;
}

export async function closeWorkspaceBuildTests(domainId: string, workspaceId: string, locale?: string) {
  const query = new URLSearchParams({ domainId });
  const url = buildUrl(getApiConfig(), `/ontology/build-tests/internal/workspaces/${workspaceId}?${query}`);
  await backendDelete("app-builder-close-workspace-tests", url, {
    headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken },
    locale,
  });
}

function sampleFilePath(file: string) {
  const value=workspacePathSchema.safeParse(file);
  if(!value.success) throw new HttpError(400,`Invalid sample file path: ${file}`,"BUILD_TEST_SAMPLE_INVALID");
  return value.data;
}
/** Node owns workspace access and bytes; Java owns context state and all execution decisions. */
export class WorkspaceBuildTests {
  runtime: RuntimeClient;
  constructor(
    readonly owner: AssistantOwner,
    readonly credentials: AssistantCredentials,
    readonly workspaceId: string,
    readonly workspaceOwnerId?: string,
  ) {
    this.runtime = new RuntimeClient(owner.domainId, undefined, owner.userId, workspaceOwnerId ?? owner.userId);
  }
  async authorize() {
    if (this.workspaceOwnerId === undefined) {
      const { appBuilderProjectStore, appWorkspaceSlot } = await import("./project-store");
      const project = await appBuilderProjectStore.findByWorkspaceId(this.owner.domainId, this.workspaceId);
      if (project) {
        const { authorizeBuilderProject } = await import("./project-service");
        await authorizeBuilderProject(this.owner, this.credentials, project.appId, { skipLiveRead: true });
        this.runtime = new RuntimeClient(this.owner.domainId, undefined, this.owner.userId, appWorkspaceSlot(project.appId));
      }
    }
    await this.runtime.request(`/v1/workspaces/${this.workspaceId}`);
  }
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
}
