import fs from "node:fs";
import path from "node:path";
import type { ParsedLogRecord, WorkspaceBackendSessionEvidence } from "@ontomato/contracts/observe";
import type { QueryBackendSession } from "@ontomato/contracts/query-execution";
import { getLogContext, parseTurnKey } from "../../../../logging/log-context";
import { assistantEvidenceReader } from "../workspaces/assistant-source";
import { queryWorkbenchServiceLogs, queryOntologyServiceLogs, queryRuntimeServiceLogs, readServiceLogWindow, type LogTimeWindow } from "../service-logs";
import type { ServiceLogQuery } from "@ontomato/contracts/service-logging";
export interface LogCollectorInput {
  artifactDir: string;
  workspaceId: string;
  turnKey?: string;
  taskId?: string;
  /** Backend session list in the query record; diagnosis collects evidence by session + node */
  backendSessions?: QueryBackendSession[];
  backendTimeWindow?: BackendLogTimeWindow;
  frontendLogTimeWindow?: LogTimeWindow;
  includeFrontendLogs?: boolean;
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
}

export interface BackendLogTimeWindow {
  minTs: number;
  /** Omitted while the data-agent Turn is still running. */
  maxTs?: number;
  turnRunning: boolean;
}

export interface LogCollectorResult {
  appLogCount: number;
  llmCallCount: number;
  backendLogCount: number;
  backendAgentLlmCount: number;
  backendDiagnosticEventCount: number;
  /** Retrieval status per backend session and per node */
  backendSessions: WorkspaceBackendSessionEvidence[];
  /** backend.log collection notes: session not located, no time window, or per-node failures */
  backendLogMessage?: string;
  records: ParsedLogRecord[];
}


/** Query references replace copied raw logs and model transcripts. */
export async function collectLogs(input: LogCollectorInput): Promise<LogCollectorResult> {
  const result: LogCollectorResult = { appLogCount: 0, llmCallCount: 0, backendLogCount: 0,
    backendAgentLlmCount: 0, backendDiagnosticEventCount: 0, backendSessions: [], records: [] };
  const domainId = getLogContext()?.domainId;
  const turn = input.turnKey ? parseTurnKey(input.turnKey) : null;
  const references: Array<{ service: string; query: ServiceLogQuery }> = [];
  if (turn && domainId) {
    const evidence = await assistantEvidenceReader().readTurn(turn.threadId, turn.requestSeq, { domainId, scope: "domain" });
    for (const { run } of evidence.runs) {
      const query = { correlationId: run.correlationId, from: new Date(Date.parse(run.createdAt) - 5000).toISOString(), to: new Date((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) + 5000).toISOString() };
      for (const service of input.includeFrontendLogs === false ? ["ontology"] : ["workbench", "ontology", "agent-runtime"]) references.push({ service, query });
    }
  } else if (input.backendTimeWindow) {
    for (const session of input.backendSessions ?? []) references.push({ service: "ontology", query: {
      sessionId: session.sessionId, from: new Date(input.backendTimeWindow.minTs).toISOString(),
      to: new Date(input.backendTimeWindow.maxTs ?? Date.now()).toISOString(),
    } });
  }
  fs.mkdirSync(input.artifactDir, { recursive: true });
  fs.writeFileSync(path.join(input.artifactDir, "service-log-queries.json"), JSON.stringify(references, null, 2));
  const records = new Map<string, ParsedLogRecord>();
  const failures: string[] = [];
  for (const { service, query } of references) {
    try {
      const read = service === "workbench" ? queryWorkbenchServiceLogs : service === "ontology"
        ? (q: ServiceLogQuery) => queryOntologyServiceLogs(q, input)
        : (q: ServiceLogQuery) => queryRuntimeServiceLogs(q, domainId);
      for (const record of await readServiceLogWindow(query, read, input.signal)) records.set(record.logId!, record);
    } catch (error) {
      input.signal?.throwIfAborted();
      failures.push(`${service}: ${error instanceof Error ? error.message : "query failed"}`);
    }
  }
  result.records = [...records.values()];
  result.appLogCount = result.records.filter(r => r.source !== "backend").length;
  result.backendLogCount = result.records.filter(r => r.source === "backend").length;
  result.backendLogMessage = failures.length ? `Service log evidence unavailable: ${failures.join("; ")}` : references.length ? undefined : "No persisted run/window is available for log lookup";
  return result;
}
