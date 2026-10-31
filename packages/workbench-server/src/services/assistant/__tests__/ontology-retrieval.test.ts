import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantService } from "../service";
import { assistantStore, type TurnRow } from "../store";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const calls = vi.hoisted(() => ({ requests: [] as Array<{ path: string; options: any }> }));
const route = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/backend-client")>()),
  backendGet: async (path: string, _url: string, options: any) => (
    calls.requests.push({ path, options }),
    { headers: new Headers(), status: 200, statusText: "OK", text: JSON.stringify(route.get(path) ?? null) }
  ),
  backendPost: async (path: string, _url: string, _body: unknown, options: any) => (
    calls.requests.push({ path, options }),
    { headers: new Headers(), status: 200, statusText: "OK", text: JSON.stringify(route.get(path) ?? null) }
  ),
}));
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
  it("accepts a copied dataset only through the ontology receipt of the same bytes", async () => {
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: [], decisionRevision: 0,
        bindings: {
          status: "completed", error: null,
          datasets: [{ id: "66666666-6666-4666-8666-666666666666", sha256: "a".repeat(64), title: "Sales", qualityCheck: {} }],
        },
      },
    });
    route.set(`/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`, {
      id: "66666666-6666-4666-8666-666666666666",
      sha256: "a".repeat(64),
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
        metricUses: [],
        selfCheck: null,
        execution: { receiptId: "77777777-7777-4777-8777-777777777777", executedAt: "2026-10-30T00:00:00.000Z" },
      },
    });
    expect(await assistantService.datasetSource("session", "copy", owner)).toEqual({
      retrievalId: retrieval,
      sourceOutputId: "66666666-6666-4666-8666-666666666666",
    });
    expect(calls.requests.map((r) => r.path)).toContain(
      `/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`,
    );
  });

  it("rejects changed bytes even when the path has a dataset extension", async () => {
    vi.mocked(assistantService.artifact).mockResolvedValue(
      artifact("b".repeat(64), "outputs/result.dataset.json") as RuntimeArtifact,
    );
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: [], decisionRevision: 0,
        bindings: {
          status: "completed", error: null,
          datasets: [{ id: "66666666-6666-4666-8666-666666666666", sha256: "a".repeat(64), title: "Sales", qualityCheck: {} }],
        },
      },
    });
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toMatchObject({ status: 404 });
    expect(calls.requests.some((r) => r.path.includes("/datasets/"))).toBe(false);
  });

  it("does not accept an ontology receipt without a resolved dataset as proof", async () => {
    route.set(`/ontology/retrievals/${retrieval}/runs/${run}/evidence`, {
      input: { question: "Sales?", userQuotes: [], previousDatasetIds: [], interaction: "resumable" },
      snapshot: {
        id: retrieval, revision: 1, runtimeSessionId: session, runtimeRunId: run,
        run: null, cursor: 0, deliveries: [], datasetArtifactIds: [], decisionRevision: 0,
        bindings: {
          status: "completed", error: null,
          datasets: [{ id: "66666666-6666-4666-8666-666666666666", sha256: "a".repeat(64), title: "Sales", qualityCheck: {} }],
        },
      },
    });
    route.set(`/ontology/retrievals/${retrieval}/datasets/66666666-6666-4666-8666-666666666666`, {
      id: "66666666-6666-4666-8666-666666666666",
    });
    await expect(assistantService.datasetSource("session", "copy", owner)).rejects.toThrow();
  });

  it("closes the parent's ontology scope with the caller's own credential", async () => {
    route.set(`/ontology/retrieval-callers/parent-run/close`, { closed: true });
    await assistantService.stopChildren("parent-run", owner, { token: "user-token" });
    const close = calls.requests.find((r) => r.path === "/ontology/retrieval-callers/parent-run/close");
    expect(close?.path).toBe("/ontology/retrieval-callers/parent-run/close");
    expect(close?.options.headers).toMatchObject({ tk: "user-token" });
  });
});
