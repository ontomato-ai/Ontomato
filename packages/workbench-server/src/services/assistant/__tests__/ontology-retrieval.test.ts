import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantService } from "../service";
import { assistantStore, type TurnRow } from "../store";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const calls = vi.hoisted(() => ({ requests: [] as Array<{ path: string; options: any; body?: unknown }> }));
const route = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/backend-client")>()),
  backendGet: async (path: string, _url: string, options: any) => (
    calls.requests.push({ path, options }),
    { headers: new Headers(), status: 200, statusText: "OK", text: JSON.stringify(route.get(path) ?? null) }
  ),
  backendPost: async (path: string, _url: string, body: unknown, options: any) => (
    calls.requests.push({ path, options, body }),
    { headers: new Headers(), status: 200, statusText: "OK", text: JSON.stringify(route.get(path) ?? null) }
  ),
}));
vi.mock("../governance", () => ({ closeGovernanceWindow: vi.fn() }));
vi.mock("../authoring", () => ({ closeAuthoringRun: vi.fn() }));
vi.mock("../skills", () => ({ prepareAssistantSkills: vi.fn() }));

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});

const owner = { userId: "user-a", domainId: "domain-a" };
const session = "11111111-1111-4111-8111-111111111111";
const retrieval = "22222222-2222-4222-8222-222222222222";
const run = "33333333-3333-4333-8333-333333333333";
const artifact = (sha256: string, path: string) => ({
  id: "44444444-4444-4444-8444-444444444444",
  sessionId: "55555555-5555-4555-8555-555555555555",
  runId: run,
  toolCallId: null,
  path,
  sha256,
  size: 12,
  mediaType: "image/png",
  createdAt: "2026-10-30T00:00:00.000Z",
  seq: 1,
});

beforeEach(() => {
  process.env.API_BASE_URL = "https://ontology.test";
  calls.requests = [];
  route.clear();
  vi.spyOn(assistantService, "artifact").mockResolvedValue(
    artifact("a".repeat(64), "outputs/result.dataset.json") as RuntimeArtifact,
  );
  vi.spyOn(assistantService, "content").mockResolvedValue(Buffer.from(JSON.stringify({
    execution: { receiptId: "77777777-7777-4777-8777-777777777777" },
  })) as never);
  vi.spyOn(assistantStore, "turns").mockResolvedValue([
    { retrieval_scope_id: "caller" } as TurnRow,
  ]);
  route.set(`/ontology/retrieval-callers/caller`, {
    id: retrieval,
    closed: false,
    retrievals: [{ retrievalId: retrieval, runId: run }],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.API_BASE_URL;
});

describe("assistant ontology provenance", () => {
  it("accepts a retriever file through its round's accepted artifact of the same bytes", async () => {
    route.set(`/ontology/ai/sessions/${session}/artifacts/66666666-6666-4666-8666-666666666666`,
      { ...artifact("a".repeat(64), "outputs/result.dataset.json"), id: "66666666-6666-4666-8666-666666666666", sessionId: session });
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: ["66666666-6666-4666-8666-666666666666"], decisionRevision: 0, outputIds: [],
      },
    });
    route.set(`/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`, {
      id: "66666666-6666-4666-8666-666666666666",
      payload: {
        schema: "workbench.dataset.v1",
        title: "Sales",
        question: "Sales?",
        columns: [{ key: "total", label: "Total", type: "number" }],
        rows: [{ total: 1 }],
        recipe: { kind: "python", code: "print(1)", sha256: "c".repeat(64) },
        outKeyRefs: [{ key: "total", className: "Sales", attrName: "total", asGroupBy: false, statCal: false }],
        truncation: null,
        assumptions: [],
        decisionIds: [],
        selfCheck: null,
        execution: { receiptId: "77777777-7777-4777-8777-777777777777", executedAt: "2026-10-30T00:00:00.000Z" },
      },
    });
    expect(await assistantService.datasetSource("session", "copy", owner)).toEqual({
      retrievalId: retrieval,
      sourceArtifactId: "66666666-6666-4666-8666-666666666666",
    });
    expect(calls.requests.map((r) => r.path)).toContain(
      `/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`,
    );
  });

  it("resolves a metric file through the formal output its receipt and bytes name", async () => {
    const output = "99999999-9999-4999-8999-999999999999";
    route.set(`/ontology/retrievals/${retrieval}/dataset-source`, { runId: run, outputId: output });
    expect(await assistantService.datasetSource("session", "copy", owner)).toEqual({
      retrievalId: retrieval, sourceOutputId: output,
    });
    expect(calls.requests.some((r) => r.path === `/ontology/retrievals/${retrieval}/dataset-source`)).toBe(true);
    expect(calls.requests.some((r) => r.path.includes("/evidence"))).toBe(false);
  });

  it("rejects changed bytes even when the path has a dataset extension", async () => {
    route.set(`/ontology/ai/sessions/${session}/artifacts/66666666-6666-4666-8666-666666666666`,
      { ...artifact("a".repeat(64), "outputs/result.dataset.json"), id: "66666666-6666-4666-8666-666666666666", sessionId: session });
    vi.mocked(assistantService.artifact).mockResolvedValue(
      artifact("b".repeat(64), "outputs/result.dataset.json") as RuntimeArtifact,
    );
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: ["66666666-6666-4666-8666-666666666666"], decisionRevision: 0, outputIds: [],
      },
    });
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toMatchObject({ status: 404 });
    expect(calls.requests.some((r) => r.path.includes("/datasets/"))).toBe(false);
  });

  it("does not accept an ontology receipt without a resolved dataset as proof", async () => {
    route.set(`/ontology/ai/sessions/${session}/artifacts/66666666-6666-4666-8666-666666666666`,
      { ...artifact("a".repeat(64), "outputs/result.dataset.json"), id: "66666666-6666-4666-8666-666666666666", sessionId: session });
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: ["66666666-6666-4666-8666-666666666666"], decisionRevision: 0, outputIds: [],
      },
    });
    route.set(`/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`, {
      id: "66666666-6666-4666-8666-666666666666",
    });
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toThrow();
  });

  it("keeps the runtime's delegated tasks and puts each check under the reply that cited its outputs",async()=>{
    const reply="88888888-8888-4888-8888-888888888888",answer="12121212-1212-4121-8121-121212121212",check="13131313-1313-4131-8131-131313131313";
    vi.spyOn(assistantStore,"session").mockResolvedValue({} as never);
    vi.mocked(assistantStore.turns).mockResolvedValue([{id:reply,retrieval_scope_id:reply} as TurnRow,{id:answer,retrieval_scope_id:answer} as TurnRow]);
    route.set(`/ontology/retrieval-callers/${reply}/quality`,{quality:[],qualityResults:[],settled:true});
    route.set(`/ontology/retrieval-callers/${answer}/quality`,{quality:[{kind:"quality",id:check,parentTaskId:run,status:"completed",error:null,
      createdAt:"2026-11-12T02:01:00Z",process:{mode:"none"},checks:{datasets:[{id:"99999999-9999-4999-8999-999999999999",title:"Sales"}]}}],
      qualityResults:[{taskId:check,score:90,summary:null,conclusion:"Matches",fittedQuestion:"Sales?"}],settled:true});
    vi.spyOn(assistantService,"channelTasks").mockResolvedValue({sessionId:session,tasks:[{kind:"agent",id:run,title:"Sales?",root:{sessionId:session,runId:reply},requestedBy:{session:{providerId:"workbench",sessionId:session},runId:reply},agentRef:{providerId:"ontology",agentId:retrieval},sessionRef:{providerId:"ontology",sessionId:retrieval},runId:run,parentTaskId:null,status:"completed",error:null,createdAt:"2026-11-12T02:00:00Z",process:{mode:"none"},results:[],retrieval:{question:"Sales?",decisionRevision:0,datasets:[]}}],qualityResults:[]});
    const read=await assistantService.tasks(session,owner);
    expect(read.snapshot.tasks[0]).toMatchObject({id:run,root:{sessionId:session,runId:reply}});
    // The retriever's card stays with the reply that delegated it; its check lands under the reply that answered.
    expect(read.snapshot.tasks[1]).toMatchObject({kind:"quality",id:check,parentTaskId:run,root:{sessionId:session,runId:answer}});
    expect(read.snapshot.qualityResults.map(result=>result.taskId)).toEqual([check]);
    expect(read.snapshot.tasks[0]).not.toHaveProperty("callerId");
    expect(read.settled).toBe(false);
  });

  it("explicit cancellation closes only the parent query scope with its own credential", async () => {
    route.set(`/ontology/retrieval-callers/parent-run/close`, { closed: true });
    vi.spyOn(assistantStore,"turn").mockResolvedValue({retrieval_scope_id:"parent-run"} as never);
    vi.spyOn(assistantStore,"settled").mockResolvedValue();
    await assistantService.cancelScope("parent-run",owner,{token:"user-token"});
    const close = calls.requests.find((r) => r.path === "/ontology/retrieval-callers/parent-run/close-scope");
    expect(close?.path).toBe("/ontology/retrieval-callers/parent-run/close-scope");
    expect(close?.options.headers).toMatchObject({ tk: "user-token" });
  });
  it("natural completion never closes or cancels delegated work",async()=>{
    vi.spyOn(assistantStore,"turn").mockResolvedValue({retrieval_scope_id:null} as never);
    const settled=vi.spyOn(assistantStore,"settled").mockResolvedValue();
    await assistantService.settleTurn("parent-run",owner,session);
    expect(settled).toHaveBeenCalledWith("parent-run");
    expect(calls.requests).toEqual([]);
  });

  it("checks only the datasets the finished answer cites, one check per round",async()=>{
    const reply="parent-run",metric="99999999-9999-4999-8999-999999999999",first="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",second="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.spyOn(assistantStore,"turn").mockResolvedValue({retrieval_scope_id:reply} as never);
    vi.spyOn(assistantStore,"settled").mockResolvedValue();
    const text=["Totals: [Metric](outputs/metrics/m.dataset.json) and ![Rows](./outputs/agents/t/a.dataset.json)",
      "Again [Rows](outputs/agents/t/a.dataset.json), also [Other](outputs/agents/t/b.dataset.json).",
      "```\n[Example](outputs/agents/t/example.dataset.json)\n```","[Report](outputs/report.md)"].join("\n\n");
    vi.spyOn(RuntimeClient.prototype,"run").mockResolvedValue({run:{stopReason:"stop",answerMessageId:"answer"},
      messages:[{id:"draft",message:{role:"assistant",content:[{type:"text",text:"[Draft](outputs/agents/t/c.dataset.json)"}]}},
        {id:"answer",message:{role:"assistant",content:[{type:"text",text}]}}]} as never);
    const resolved=vi.spyOn(assistantService,"resolve").mockImplementation(async(_session,_run,path)=>({artifact:{id:path} as RuntimeArtifact}));
    vi.spyOn(assistantService,"formalOutput").mockImplementation(async(_session,id)=>id==="outputs/metrics/m.dataset.json"
      ? {scopeId:reply,retrievalId:"metric-retrieval",runId:"metric-run",outputId:metric}
      : {scopeId:"dispatch",retrievalId:retrieval,runId:run,outputId:id.endsWith("a.dataset.json")?first:second});
    await assistantService.settleTurn(reply,owner,session);
    expect(resolved.mock.calls.map(call=>call[2]).sort()).toEqual(["outputs/agents/t/a.dataset.json","outputs/agents/t/b.dataset.json","outputs/metrics/m.dataset.json"]);
    const admissions=calls.requests.filter(request=>request.path.endsWith("/quality"));
    expect(admissions.map(request=>[request.path,request.options.headers["X-Ontomato-Retrieval-Caller-Id"],request.body])).toEqual([
      ["/ontology/retrievals/metric-retrieval/runs/metric-run/quality",reply,{replyRunId:reply,outputIds:[metric]}],
      [`/ontology/retrievals/${retrieval}/runs/${run}/quality`,"dispatch",{replyRunId:reply,outputIds:[first,second]}],
    ]);
  });

  it("a check that cannot be admitted leaves the finished reply settled",async()=>{
    vi.spyOn(assistantStore,"turn").mockResolvedValue({retrieval_scope_id:"parent-run"} as never);
    const settled=vi.spyOn(assistantStore,"settled").mockResolvedValue();
    vi.spyOn(RuntimeClient.prototype,"run").mockRejectedValue(new Error("runtime unavailable"));
    await assistantService.settleTurn("parent-run",owner,session);
    expect(settled).toHaveBeenCalledWith("parent-run");
  });
});
