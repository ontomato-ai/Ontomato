import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { panelReadOperationResultSchema } from "@ontomato/contracts/panel-operations";
import type { DiagnosisEvidence } from "@ontomato/contracts/ops-diagnosis";
import {
  AUTOTEST_CASE_ARTIFACT,
  AUTOTEST_RUN,
  BUILD_TURN_EVIDENCE,
  DELETE_AUTOTEST_RUN,
  DELETE_TURN_EVIDENCE,
  DOWNLOAD_AUTOTEST_CASE_ARTIFACT,
  DOWNLOAD_AUTOTEST_RUN,
  DOWNLOAD_TURN_EVIDENCE,
  DSL_QUERY,
  EXECUTE_DSL_QUERY,
  KEEP_AUTOTEST_RUN,
  KEEP_TURN_EVIDENCE,
  OPS_KNOWLEDGE,
  TURN_EVIDENCE,
  UNKEEP_AUTOTEST_RUN,
  UNKEEP_TURN_EVIDENCE,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { buildTurnWorkspace } from "../../../platform/diagnosis/observe/workspaces/builder";
import { loadManifest, saveManifest } from "../../../platform/diagnosis/observe/workspaces/store";
import { panelServerOperation, type PanelOperationHost, type PanelReadServerOperation, type PanelWriteServerOperation } from "../../product-panels/server-operations";
import { platformTypeEntries } from "../../product-panels/type-table";
import {
  createAutotestCaseArtifactReadAdapter,
  createAutotestRunReadAdapter,
  createDslQueryReadAdapter,
  createOpsKnowledgeReadAdapter,
  createTurnEvidenceReadAdapter,
  DEFAULT_DSL_QUERY_TEXT,
  encodeAutotestCaseArtifactKey,
} from "../panel-reads";
import { registerDslResultSectionProvider } from "../panel-operations";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const mocks = vi.hoisted(() => ({
  assertObserveAccess: vi.fn<Parameters<WorkbenchIdentity["assertObserveAccess"]>, ReturnType<WorkbenchIdentity["assertObserveAccess"]>>(async () => {}),
  knowledgeDir: "",
  workspacesDir: "",
  autotestDataDir: "",
  keptArtifacts: new Set<string>(),
  verifyDomain: vi.fn(async () => {}),
  resolveEvidence: vi.fn(),
  executeDslViaBackend: vi.fn(),
  activeRun: null as { runId: string } | null,
}));

const objectWrite = (ref: string) =>
  panelServerOperation(ref) as Extract<PanelWriteServerOperation, { targetType: string }>;
const globalWrite = (ref: string) =>
  panelServerOperation(ref) as Extract<PanelWriteServerOperation, { kind: "action"; targetInput?: undefined }>;
const objectRead = (ref: string) =>
  panelServerOperation(ref) as PanelReadServerOperation;

vi.mock("../../../content/layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../content/layout")>();
  return {
    ...actual,
    knowledgeDir: () => mocks.knowledgeDir,
    publicSkillsRoot: () => mocks.knowledgeDir || os.tmpdir(),
    domainSkillsRoot: () => mocks.knowledgeDir || os.tmpdir(),
    runtimeRoot: () => mocks.knowledgeDir || os.tmpdir(),
  };
});

vi.mock("../../../config/environment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config/environment")>();
  return {
    ...actual,
    environment: {
      ...actual.environment,
      observeWorkspaces: () => mocks.workspacesDir,
    },
  };
});

vi.mock("../../../platform/diagnosis/autotest/config", () => ({
  autotestConfig: {
    get dataDir() {
      return mocks.autotestDataDir;
    },
  },
}));

vi.mock("../../../platform/diagnosis/autotest/runner/run-controller", () => ({
  getActiveRun: () => mocks.activeRun,
  isRunActive: (runId: string) => mocks.activeRun?.runId === runId,
}));

vi.mock("../../../platform/diagnosis/observe/artifact-retention/store", () => ({
  getArtifactRetentionSnapshot: async () =>
    [...mocks.keptArtifacts].map((entry) => {
      const [artifactType, artifactId] = entry.split(":");
      return { artifactType, artifactId, kept: true, updatedAt: "2026-11-25T00:00:00.000Z" };
    }),
  setArtifactKept: async (artifactType: string, artifactId: string, kept: boolean) => {
    const key = `${artifactType}:${artifactId}`;
    if (kept) mocks.keptArtifacts.add(key);
    else mocks.keptArtifacts.delete(key);
  },
  clearArtifactRetentionBestEffort: async (artifactType: string, artifactId: string) => {
    mocks.keptArtifacts.delete(`${artifactType}:${artifactId}`);
  },
}));

vi.mock("../../../platform/diagnosis/observe/workspaces/assistant-source", () => ({
  assistantEvidenceReader: () => ({ verifyDomain: mocks.verifyDomain }),
}));

vi.mock("../../../platform/diagnosis/observe/workspaces/diagnosis-source", () => ({
  diagnosisEvidenceReader: () => ({ resolve: mocks.resolveEvidence }),
}));

vi.mock("../../data-query/dsl-executor", () => ({
  executeDslViaBackend: mocks.executeDslViaBackend,
}));

function makeHost(domainId = "domain-a", locale = "en"): PanelOperationHost {
  const actor = { owner: { domainId, userId: "user-1" }, credentials: { token: "tok", locale } };
  return {
    initiator: actor,
    executor: actor,
    locale,
    requestWorkbench: vi.fn(),
    request: vi.fn(),
  };
}

function turnEvidence(turnKey: string): DiagnosisEvidence {
  return {
    target: { kind: "turn", turnKey },
    resolvedAt: "2026-11-25T01:00:00.000Z",
    runs: [],
    logQueries: [],
    gaps: [],
  };
}

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function holdTurnCollection() {
  const started = defer<void>();
  const result = defer<DiagnosisEvidence>();
  mocks.resolveEvidence.mockImplementationOnce(() => {
    started.resolve();
    return result.promise;
  });
  return { started: started.promise, ...result };
}

let tempRoot = "";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ops-panel-owner-"));
  mocks.knowledgeDir = path.join(tempRoot, "knowledge");
  mocks.workspacesDir = path.join(tempRoot, "traces");
  mocks.autotestDataDir = path.join(tempRoot, "autotest");
  mocks.keptArtifacts.clear();
  mocks.activeRun = null;
  mocks.assertObserveAccess.mockReset().mockResolvedValue(undefined);
  mocks.verifyDomain.mockReset().mockResolvedValue(undefined);
  mocks.resolveEvidence.mockReset();

  fs.mkdirSync(path.join(mocks.knowledgeDir, "guides"), { recursive: true });
  fs.writeFileSync(path.join(mocks.knowledgeDir, "index.md"), "# Ops Guide\n\nSee [Logs](./guides/logs.md).", "utf8");
  fs.writeFileSync(path.join(mocks.knowledgeDir, "guides/logs.md"), "---\ntitle: Log Guide\n---\nCheck logs.", "utf8");

  installWorkbenchIdentity({
    authenticate: (_req, _res, next) => next(),
    resolveAutotestActor: async () => ({ userId: "user-1", domainId: "domain-a" }),
    resolveMcpCaller: async () => ({ userId: "user-1", domainId: "domain-a" }),
    resolveSkillResourceDomain: async () => ({ ok: true, domainId: "domain-a" }),
    requirePermission: () => (_req, _res, next) => next(),
    assertPermission: async () => {},
    requireDeploymentMaintenance: (_req, _res, next) => next(),
    guardMcpServiceManagement: (_req, _res, next) => next(),
    observeAccess: (_req, _res, next) => next(),
    assertObserveAccess: mocks.assertObserveAccess,
    requireDomainId: ({ domainId }) => {
      if (!domainId) throw new HttpError(403, "Domain required");
      return domainId;
    },
  });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("Observe and Autotest panel owner reads and operations", () => {
  it("lists and reads OpsKnowledge documents and enforces observe access", async () => {
    const adapter = createOpsKnowledgeReadAdapter({ domainId: "domain-a", userId: "user-1" }, { token: "tok", locale: "en" });
    const files = await adapter.files();
    expect(files.map((item) => item.primaryKey)).toEqual(["guides/logs.md", "index.md"]);
    expect(files[0]!.className).toBe(OPS_KNOWLEDGE);

    const doc = await adapter.record("guides/logs.md");
    expect(doc.label).toBe("Log Guide");
    expect(doc.fields.path).toBe("guides/logs.md");
    expect(doc.fields.content).toContain("Check logs.");

    mocks.assertObserveAccess.mockRejectedValueOnce(new HttpError(403, "Missing observer permission"));
    await expect(adapter.files()).rejects.toMatchObject({ status: 403 });
  });

  it("isolates TurnEvidence by domain and supports retention, build, delete, and ZIP download", async () => {
    const turnA = "turn.threadA.1";
    const turnOther = "turn.threadB.2";
    const dirA = path.join(mocks.workspacesDir, turnA);
    const dirB = path.join(mocks.workspacesDir, turnOther);
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(
      path.join(dirA, "manifest.json"),
      JSON.stringify({
        workspaceId: turnA,
        turnKey: turnA,
        domainId: "domain-a",
        status: "ready",
        question: "Why did query fail?",
        createdAt: "2026-11-25T01:00:00.000Z",
        evidence: {
          version: 1,
          target: { kind: "assistant-run", sessionId: "s1", runId: "r1" },
          runs: [{ owner: "assistant", sessionId: "s1", runId: "r1", artifactIds: ["a1"] }],
          gaps: [{ source: "backend", code: "MISSING", message: "Backend log unavailable" }],
        },
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(dirA, "result.csv"), "a,b\n1,2\n", "utf8");
    fs.writeFileSync(
      path.join(dirB, "manifest.json"),
      JSON.stringify({ workspaceId: turnOther, turnKey: turnOther, domainId: "domain-b", status: "ready" }),
      "utf8",
    );

    const adapter = createTurnEvidenceReadAdapter({ domainId: "domain-a", userId: "user-1" }, { token: "tok", locale: "en" });
    const listed = await adapter.list();
    expect(listed.map((r) => r.primaryKey)).toEqual([turnA]);

    const record = await adapter.record(turnA);
    expect(record.outputs).toEqual({ status: "ready", kept: false, hasEvidence: true });
    expect((await adapter.evidenceRuns(turnA)).map((r) => r.fields.runId)).toEqual(["r1"]);
    expect((await adapter.evidenceGaps(turnA)).map((r) => r.fields.code)).toEqual(["MISSING"]);
    expect((await adapter.files(turnA)).map((f) => f.primaryKey)).toContain("result.csv");
    expect((await adapter.file(turnA, "result.csv")).fields.content).toBe("a,b\n1,2\n");

    await expect(adapter.record(turnOther)).rejects.toMatchObject({ status: 404 });

    const host = makeHost("domain-a");
    const keepOp = objectWrite(KEEP_TURN_EVIDENCE);
    const unkeepOp = objectWrite(UNKEEP_TURN_EVIDENCE);
    const target = { kind: "object" as const, objectType: TURN_EVIDENCE, primaryKey: turnA };

    expect(await keepOp.unavailable?.(host, target)).toBeUndefined();
    expect(await unkeepOp.unavailable?.(host, target)).toBeDefined();
    expect(await keepOp.execute(host, target, {}, "i1")).toMatchObject({ kind: "success" });
    expect(await keepOp.unavailable?.(host, target)).toBeDefined();
    expect(await unkeepOp.unavailable?.(host, target)).toBeUndefined();

    const downloadOp = objectRead(DOWNLOAD_TURN_EVIDENCE);
    expect(await downloadOp.unavailable?.(host, target)).toBeUndefined();
    const downloaded = await downloadOp.execute(host, { target, input: {} });
    expect(downloaded.kind).toBe("file");
    if (downloaded.kind === "file") {
      expect(downloaded.mime).toBe("application/zip");
      const zip = new AdmZip(Buffer.from(downloaded.bytes as Uint8Array));
      expect(zip.getEntries().map((e) => e.entryName)).toContain(`${turnA}/evidence.json`);
    }

    const buildOp = globalWrite(BUILD_TURN_EVIDENCE);
    mocks.resolveEvidence.mockResolvedValueOnce(turnEvidence("turn.threadA.9"));
    const built = await buildOp.execute(host, null, { turnKey: "turn.threadA.9" }, "i2");
    expect(built).toMatchObject({
      kind: "success",
      created: { objectType: TURN_EVIDENCE, primaryKey: "turn.threadA.9" },
    });

    const deleteOp = objectWrite(DELETE_TURN_EVIDENCE);
    expect(await deleteOp.inspectImpact?.inspect(host, [{ target, input: {} }])).toMatchObject({ total: 1 });
    expect(await deleteOp.execute(host, target, {}, "i3")).toMatchObject({ kind: "success" });
    expect((await adapter.list()).map((row) => row.primaryKey)).toEqual(["turn.threadA.9"]);
  });

  it.each(["first build", "rebuild"])("reads a collecting Turn during a %s and then reads the persisted result", async (mode) => {
    const turnKey = "turn.threadA.3";
    const keptKey = "turn.threadA.4";
    const host = makeHost();
    const { domainId } = host.executor.owner;
    const adapter = createTurnEvidenceReadAdapter(host.executor.owner, host.executor.credentials);
    const other = makeHost("domain-b");
    const otherAdapter = createTurnEvidenceReadAdapter(other.executor.owner, other.executor.credentials);
    saveManifest(keptKey, { workspaceId: keptKey, domainId, status: "completed", createdAt: "2026-11-25T01:00:00.000Z" });
    mocks.keptArtifacts.add(`turn-workspace:${keptKey}`);
    if (mode === "rebuild") {
      saveManifest(turnKey, { workspaceId: turnKey, domainId, status: "completed", createdAt: "2026-11-25T00:00:00.000Z" });
    } else {
      await expect(adapter.record(turnKey)).rejects.toMatchObject({ status: 404 });
    }

    const collection = holdTurnCollection();
    const build = globalWrite(BUILD_TURN_EVIDENCE).execute(host, null, { turnKey }, "i1");
    await collection.started;
    const duplicate = buildTurnWorkspace({ turnKey, domainId });
    try {
      const rows = await adapter.list();
      expect(rows.map((row) => row.primaryKey)).toEqual([turnKey, keptKey]);
      expect(rows[0]).toMatchObject({
        fields: { status: "collecting", statusLabel: expect.any(String), statusTone: "info", hasEvidence: false },
        tones: { statusLabel: "info" },
      });
      expect(rows[0]!.fields.statusLabel).not.toBe("collecting");
      const detail = await adapter.record(turnKey);
      expect(detail).toMatchObject({
        primaryKey: turnKey,
        fields: {
          status: "collecting",
          statusLabel: rows[0]!.fields.statusLabel,
          statusTone: "info",
          createdAt: rows[0]!.fields.createdAt,
        },
        tones: { statusLabel: "info" },
        outputs: { status: "collecting", kept: false, hasEvidence: false },
      });
      expect(await adapter.evidenceRuns(turnKey)).toEqual([]);
      expect(await adapter.evidenceGaps(turnKey)).toEqual([]);
      expect(await adapter.files(turnKey)).toEqual([]);
      expect(await otherAdapter.list()).toEqual([]);
      await expect(otherAdapter.record(turnKey)).rejects.toMatchObject({ status: 404 });
      await expect(buildTurnWorkspace({ turnKey, domainId: "domain-b" })).rejects.toMatchObject({ status: 404 });
    } finally {
      collection.resolve(turnEvidence(turnKey));
      await Promise.all([build, duplicate]);
    }

    expect(mocks.resolveEvidence).toHaveBeenCalledTimes(1);
    expect(await build).toMatchObject({ kind: "success", data: { turnKey } });
    expect(loadManifest(turnKey)).toMatchObject({ status: "completed", evidence: turnEvidence(turnKey) });
    expect((await adapter.list()).map((row) => row.primaryKey)).toEqual([keptKey, turnKey]);
    expect(await adapter.record(turnKey)).toMatchObject({ outputs: { status: "completed", hasEvidence: true } });
  });

  it("propagates a failed first collection and removes the in-progress Turn", async () => {
    const turnKey = "turn.threadA.3";
    const host = makeHost();
    const adapter = createTurnEvidenceReadAdapter(host.executor.owner, host.executor.credentials);
    const collection = holdTurnCollection();
    const build = globalWrite(BUILD_TURN_EVIDENCE).execute(host, null, { turnKey }, "i1");
    await collection.started;
    const error = new HttpError(503, "Evidence source unavailable", "DEPENDENCY_UNAVAILABLE");
    const failed = expect(build).rejects.toBe(error);
    try {
      expect(await adapter.record(turnKey)).toMatchObject({ outputs: { status: "collecting" } });
    } finally {
      collection.reject(error);
      await failed;
    }
    expect(loadManifest(turnKey)).toBeNull();
    expect(await adapter.list()).toEqual([]);
    await expect(adapter.record(turnKey)).rejects.toMatchObject({ status: 404 });
  });

  it("reads AutotestRun results, enforces busy delete protection, and serves AutotestCaseArtifact files and ZIPs", async () => {
    const runId = "run-101";
    const runDir = path.join(mocks.autotestDataDir, "runs", runId);
    const caseDir = path.join(runDir, "c1");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.json"),
      JSON.stringify({
        runId,
        domainId: "domain-a",
        caseSetId: "cs1",
        caseSetName: "Smoke suite",
        status: "completed",
        createdAt: "2026-11-25T02:00:00.000Z",
        updatedAt: "2026-11-25T02:05:00.000Z",
        completedAt: "2026-11-25T02:05:00.000Z",
        summary: { total: 2, correct: 1, wrong: 1, abnormal: 0 },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(runDir, "results.json"),
      JSON.stringify([
        { caseId: "c1", question: "Q1", status: "success", durationMs: 1200, answerEvaluation: { passed: true } },
        { caseId: "c2", question: "Q2", status: "success", durationMs: 800, answerEvaluation: { passed: false, analysis: "Wrong sum" } },
      ]),
      "utf8",
    );
    fs.writeFileSync(
      path.join(caseDir, "manifest.json"),
      JSON.stringify({
        workspaceId: "c1",
        status: "ready",
        question: "Q1",
        evidence: {
          version: 1,
          target: { kind: "autotest-case", runId, caseId: "c1" },
          runs: [{ owner: "autotest", sessionId: "s1", runId: "r1", artifactIds: [] }],
          gaps: [],
        },
      }),
      "utf8",
    );
    fs.writeFileSync(path.join(caseDir, "trace.json"), '{"ok":true}', "utf8");

    const runAdapter = createAutotestRunReadAdapter({ domainId: "domain-a", userId: "user-1" }, { token: "tok", locale: "en" });
    expect((await runAdapter.list()).map((r) => r.primaryKey)).toEqual([runId]);
    const runRecord = await runAdapter.record(runId);
    expect(runRecord.outputs).toEqual({ status: "completed", active: false, kept: false });
    expect(runRecord.fields.accuracyRate).toBe("50.0%");

    const wrongOnly = await runAdapter.results(runId, { verdict: "wrong" });
    expect(wrongOnly.map((r) => r.fields.caseId)).toEqual(["c2"]);
    expect(wrongOnly[0]!.primaryKey).toBe(encodeAutotestCaseArtifactKey(runId, "c2"));

    const caseKey = encodeAutotestCaseArtifactKey(runId, "c1");
    const caseAdapter = createAutotestCaseArtifactReadAdapter({ domainId: "domain-a", userId: "user-1" }, { token: "tok", locale: "en" });
    const caseRecord = await caseAdapter.record(caseKey);
    expect(caseRecord.outputs).toEqual({ runId, caseId: "c1", hasEvidence: true });
    expect((await caseAdapter.file(caseKey, "trace.json")).fields.content).toBe('{\n  "ok": true\n}');

    const host = makeHost("domain-a");
    const runTarget = { kind: "object" as const, objectType: AUTOTEST_RUN, primaryKey: runId };
    const caseTarget = { kind: "object" as const, objectType: AUTOTEST_CASE_ARTIFACT, primaryKey: caseKey };

    const keepRun = objectWrite(KEEP_AUTOTEST_RUN);
    const unkeepRun = objectWrite(UNKEEP_AUTOTEST_RUN);
    expect(await keepRun.execute(host, runTarget, {}, "r1")).toMatchObject({ kind: "success" });
    expect(await unkeepRun.unavailable?.(host, runTarget)).toBeUndefined();

    const downloadRun = objectRead(DOWNLOAD_AUTOTEST_RUN);
    expect((await downloadRun.execute(host, { target: runTarget, input: {} })).kind).toBe("file");

    const downloadCase = objectRead(DOWNLOAD_AUTOTEST_CASE_ARTIFACT);
    expect((await downloadCase.execute(host, { target: caseTarget, input: {} })).kind).toBe("file");

    mocks.activeRun = { runId };
    const deleteRunOp = objectWrite(DELETE_AUTOTEST_RUN);
    expect(await deleteRunOp.unavailable?.(host, runTarget)).toBeDefined();
    expect(await deleteRunOp.execute(host, runTarget, {}, "r2")).toMatchObject({ kind: "refusal", code: "RUN_BUSY" });

    mocks.activeRun = null;
    expect(await deleteRunOp.unavailable?.(host, runTarget)).toBeUndefined();
    expect(await deleteRunOp.execute(host, runTarget, {}, "r3")).toMatchObject({ kind: "success" });
    expect((await runAdapter.list()).length).toBe(0);
  });

  it("reads the DSL draft form and executes dslQuery.execute with default 2 sections and provider-inserted middle sections", async () => {
    const adapter = createDslQueryReadAdapter({ domainId: "domain-a", userId: "user-1" }, { token: "tok", locale: "en" });
    const form = panelFormDescriptionSchema.parse(await adapter.form());
    expect(form.values).toEqual({ dsl: DEFAULT_DSL_QUERY_TEXT });
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0]).toMatchObject({
      path: "/dsl",
      control: { kind: "code", language: "json" },
      valueSchema: { type: "string" },
      defaultValue: DEFAULT_DSL_QUERY_TEXT,
    });

    const executeOp = objectRead(EXECUTE_DSL_QUERY);
    expect(executeOp.targetType).toBe(DSL_QUERY);
    expect(executeOp.target).toEqual({ source: "draft" });
    const host = makeHost("domain-a", "en");

    // Invalid JSON draft is rejected with 422.
    await expect(
      executeOp.execute(host, { target: { kind: "draft" }, input: { draft: { dsl: "{invalid" }, parameters: {} } }),
    ).rejects.toMatchObject({ status: 422, code: "INVALID_DSL_QUERY" });

    // Backend failure is surfaced as HttpError.
    mocks.executeDslViaBackend.mockResolvedValueOnce({
      ok: false,
      executeUrl: "http://backend/dsl/executeV1",
      status: 503,
      detail: "Backend down",
    });
    await expect(
      executeOp.execute(host, { target: { kind: "draft" }, input: { draft: { dsl: DEFAULT_DSL_QUERY_TEXT }, parameters: {} } }),
    ).rejects.toMatchObject({ status: 503, code: "DSL_EXECUTION_FAILED" });

    // Default response returns 2 sections: records table followed by raw JSON.
    const backendPayload = {
      success: true,
      data: {
        data: [
          {
            problem: "List servers",
            answer: [
              { id: "s1", count: 3, active: true, meta: { region: "east" } },
              { id: "s2", count: 0, active: false, meta: null },
            ],
            generatedQuery: "db.servers.find({})",
          },
        ],
      },
    };
    mocks.executeDslViaBackend.mockResolvedValue({
      ok: true,
      executeUrl: "http://backend/dsl/executeV1",
      payload: backendPayload,
    });

    const twoSections = panelReadOperationResultSchema.parse(await executeOp.execute(host, {
      target: { kind: "draft" },
      input: { draft: { dsl: '{"problem":"List servers","answer":{"steps":[]}}' }, parameters: {} },
    }));
    expect(mocks.executeDslViaBackend).toHaveBeenLastCalledWith(
      { problem: "List servers", answer: { steps: [] } },
      "tok",
    );
    expect(twoSections).toMatchObject({
      kind: "sections",
      sections: [
        {
          id: "table",
          label: "Data table",
          kind: "records",
          columns: [
            { key: "id", label: "id" },
            { key: "count", label: "count" },
            { key: "active", label: "active" },
            { key: "meta", label: "meta" },
          ],
          rows: [
            { id: "s1", count: 3, active: true, meta: '{"region":"east"}' },
            { id: "s2", count: 0, active: false, meta: null },
          ],
        },
        {
          id: "raw",
          label: "Raw response",
          kind: "json",
          value: backendPayload.data,
        },
      ],
    });

    // Registered provider inserts extra section(s) strictly between data table and raw response.
    const unregister = registerDslResultSectionProvider(({ payload }) => {
      const generated = (payload as { data?: Array<{ generatedQuery?: string }> })?.data?.[0]?.generatedQuery;
      if (!generated) return null;
      return {
        id: "generated-query",
        label: "Generated query",
        kind: "code",
        language: "javascript",
        content: generated,
      };
    });
    try {
      const threeSections = await executeOp.execute(host, {
        target: { kind: "draft" },
        input: { draft: { dsl: DEFAULT_DSL_QUERY_TEXT }, parameters: {} },
      });
      expect(threeSections.kind).toBe("sections");
      if (threeSections.kind === "sections") {
        expect(threeSections.sections.map((s) => s.id)).toEqual(["table", "generated-query", "raw"]);
        expect(threeSections.sections[1]).toEqual({
          id: "generated-query",
          label: "Generated query",
          kind: "code",
          language: "javascript",
          content: "db.servers.find({})",
        });
      }
    } finally {
      unregister();
    }

    // Observe access is enforced on both form read and execution.
    mocks.assertObserveAccess.mockRejectedValueOnce(new HttpError(403, "Forbidden"));
    await expect(adapter.form()).rejects.toMatchObject({ status: 403 });
    mocks.assertObserveAccess.mockRejectedValueOnce(new HttpError(403, "Forbidden"));
    await expect(
      executeOp.execute(host, { target: { kind: "draft" }, input: { draft: { dsl: DEFAULT_DSL_QUERY_TEXT }, parameters: {} } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("validates ops-dsl-console builtin panel source with real draftReadOperationIds and 8-locale parity", async () => {
    const repoRoot = path.resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(path.resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs"));
    const typeMap = platformTypeEntries();
    const draftReadOperationIds = [...typeMap.values()].flatMap(({ operations = [] }) =>
      operations.filter((op) => op.effect === "read" && op.target.source === "draft").map((op) => op.id),
    );
    expect(draftReadOperationIds).toContain(EXECUTE_DSL_QUERY);

    const dir = path.resolve(repoRoot, "packages/platform-admin/resources/builtin-panels/ops-dsl-console");
    await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });

    const mod = fs.readFileSync(path.resolve(dir, "panel.mjs"), "utf8");
    const html = fs.readFileSync(path.resolve(dir, "panel.html"), "utf8");
    const desc = JSON.parse(fs.readFileSync(path.resolve(dir, "panel.json"), "utf8"));
    expect(mod).not.toContain("usePanelState");
    expect(mod).not.toContain("context.refresh(");
    expect(mod).not.toContain("localStorage");
    expect(html).not.toContain("<el-");
    expect(html).not.toContain("--el-");

    const locales = ["en", "zh-CN", "zh-TW", "ja", "de", "fr", "it", "ar"];
    const messages = desc.content.messages as Record<string, Record<string, string>>;
    expect(Object.keys(messages).sort()).toEqual([...locales].sort());
    const enKeys = Object.keys(messages.en!).sort();
    for (const locale of locales) {
      expect(Object.keys(messages[locale]!).sort()).toEqual(enKeys);
    }
  });
});
