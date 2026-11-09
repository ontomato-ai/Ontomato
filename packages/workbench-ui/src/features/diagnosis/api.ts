import type {
  KnowledgeTreeResponse,
  KnowledgeMarkdownFile,
} from "@ontomato/contracts/diagnosis";
import type {
  WorkspaceManifest,
  RetainedWorkspaceManifest,
  ArtifactFileTreeNode,
  ArtifactFilePreview,
  ArtifactRetention,
  LogSourceConfig,
  ArtifactType as RetentionArtifactType,
} from "@ontomato/contracts/observe";
import type {
  CaseSet,
  CaseSetListItem,
  CaseSetImportResult,
  RunMeta,
  RetainedRunMeta,
  RunResults,
} from "@ontomato/contracts/autotest";
import type { HttpResponse } from "@ontomato/contracts/http";
import type { DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { agentHostCreateSessionResponseSchema, agentHostAdmissionSchema } from "@ontomato/contracts/agent-host";
import { api } from "../../api";
import { t } from "../../i18n";
import { ApiBusinessError, apiPost, createEventSource } from "../../utils/api";
import { apiUrl } from "../../utils/api-base";

const AUTOTEST_BASE = "/observe/autotest";

export function artifactRetentionRequestKey(
  artifactType: RetentionArtifactType,
  artifactId: string
): string {
  return `${artifactType}:${artifactId}`;
}

/** Node requests use API-relative paths; downloads and streams resolve the API base at their own boundary. */
export function createDiagnosisApi(request: Pick<typeof api, "get" | "post" | "put" | "delete"> = api) {
  async function data<T>(response: Promise<HttpResponse<T>>): Promise<T> {
    const json = await response;
    if (json.success === false) throw new ApiBusinessError(json.error || t("diagnosis.requestFailed"), json);
    return json.data;
  }

  return {
    executeDsl: (dsl: unknown) => apiPost("/dsl/executeV1", dsl),
    getKnowledgeTree: () => data<KnowledgeTreeResponse>(request.get("/observe/agent/knowledge")),
    getKnowledgeContent: (path: string) => {
      const query = new URLSearchParams({ path }).toString();
      return data<KnowledgeMarkdownFile>(request.get(`/observe/agent/knowledge/content?${query}`));
    },
    listCaseSets: () => data<CaseSetListItem[]>(request.get(`${AUTOTEST_BASE}/case-sets`)),
    getCaseSet: (id: string) => data<CaseSet>(request.get(`${AUTOTEST_BASE}/case-sets/${encodeURIComponent(id)}`)),
    saveCaseSet: (id: string, body: Pick<CaseSet, "cases">) =>
      data<CaseSet>(request.put(`${AUTOTEST_BASE}/case-sets/${encodeURIComponent(id)}`, body)),
    deleteCaseSet: (id: string) => data<void>(request.delete(`${AUTOTEST_BASE}/case-sets/${encodeURIComponent(id)}`)),
    createCaseSet: (body: Pick<CaseSet, "name" | "cases">) =>
      data<CaseSetImportResult>(request.post(`${AUTOTEST_BASE}/case-sets`, body)),
    startRun: (body: unknown) => data<RunMeta>(request.post(`${AUTOTEST_BASE}/runs`, body)),
    stopRun: (runId: string) => data<RunMeta>(request.post(`${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}/stop`)),
    listRuns: () => data<RetainedRunMeta[]>(request.get(`${AUTOTEST_BASE}/runs`)),
    deleteRun: (runId: string) => data<void>(request.delete(`${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}`)),
    getRun: (runId: string) => data<RetainedRunMeta>(request.get(`${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}`)),
    getRunResults: (runId: string) => data<RunResults>(request.get(`${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}/results`)),
    turnArtifactPath: (turnKey: string) => `/observe/turns/${encodeURIComponent(turnKey)}`,
    turnBuildPath: () => "/observe/turns",
    caseArtifactPath: (runId: string, caseId: string) =>
      `${AUTOTEST_BASE}/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}/artifacts`,
    getArtifactManifest: (path: string) => data<WorkspaceManifest>(request.get(path)),
    getArtifactTree: (path: string) =>
      data<ArtifactFileTreeNode | ArtifactFileTreeNode[]>(request.get(`${path}/tree`)),
    getArtifactFile: (path: string, encodedPath: string) =>
      data<ArtifactFilePreview>(request.get(`${path}/files/${encodedPath}`)),
    artifactDownloadUrl: (path: string, token: string) =>
      `${apiUrl(path)}/download?tk=${encodeURIComponent(token)}`,
    rebuildArtifact: (path: string, body: unknown) => data<WorkspaceManifest>(request.post(path, body)),
    listTurns: () => data<RetainedWorkspaceManifest[]>(request.get("/observe/turns")),
    deleteTurn: (turnKey: string) => data<void>(request.delete(`/observe/turns/${encodeURIComponent(turnKey)}`)),
    buildTurn: (turnKey: string) => data<WorkspaceManifest>(request.post("/observe/turns", { turnKey })),
    async setArtifactRetention(artifactType: RetentionArtifactType, artifactId: string, kept: boolean): Promise<boolean> {
      const response = await data<ArtifactRetention>(request.put(
        `/observe/retention/${artifactType}/${encodeURIComponent(artifactId)}`,
        { kept }
      ));
      const updated = response?.kept;
      if (typeof updated !== "boolean") throw new Error("Invalid artifact retention response");
      return updated;
    },
    async startDiagnosis(target: DiagnosisTarget, sessionId: string, runId: string, message: string) {
      agentHostCreateSessionResponseSchema.parse(await request.post(
        "/observe/diagnoses", { target }, { headers: { "Idempotency-Key": sessionId } }
      ));
      return agentHostAdmissionSchema.parse(await request.post(
        `/observe/agent/sessions/${encodeURIComponent(sessionId)}/runs`,
        { message },
        { headers: { "Idempotency-Key": runId } }
      ));
    },
    initializeLogSourceConfig: () => data<LogSourceConfig>(request.get("/observe/log-source-config")),
    downloadRunUrl: (runId: string, token: string) =>
      `${apiUrl(AUTOTEST_BASE)}/runs/${encodeURIComponent(runId)}/download?tk=${encodeURIComponent(token)}`,
    openRunEvents: (runId: string, token: string) =>
      createEventSource(`${apiUrl(AUTOTEST_BASE)}/runs/${encodeURIComponent(runId)}/events?tk=${encodeURIComponent(token)}`),
    openLiveLogs: (params: URLSearchParams) =>
      createEventSource(`${apiUrl("/observe")}/live-logs?${params.toString()}`),
  };
}

export const diagnosisApi = createDiagnosisApi();
