import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import type { LogQueryParams, BackendLogQueryParams } from "./types";
import type { BackendNodeRequestOptions } from "./log-sources/backend-node-client";
import { getLogContext, parseTurnKey } from "../../../logging/log-context";
import { assistantEvidenceReader } from "./workspaces/assistant-source";
import { extractErrors } from "./parsers/error-extractor";
import { queryWorkbenchServiceLogs, queryOntologyServiceLogs, readServiceLogWindow } from "./service-logs";
import type { ServiceLogQuery } from "@ontomato/contracts/service-logging";

async function queries(params: LogQueryParams): Promise<ServiceLogQuery[]> {
  if (!params.turnKey) return [{ from: params.startTime, to: params.endTime, sessionId: params.sessionId, minLevel: params.level?.toUpperCase() }];
  const turn = parseTurnKey(params.turnKey);
  if (!turn) throw new Error("Invalid turn identity");
  const evidence = await assistantEvidenceReader().readTurn(turn.threadId, turn.requestSeq, { domainId: getLogContext()?.domainId ?? "", scope: "domain" });
  return evidence.runs.map(({ run }) => ({ correlationId: run.correlationId,
    from: params.startTime ?? run.createdAt, to: params.endTime ?? run.finishedAt ?? new Date().toISOString(), minLevel: params.level?.toUpperCase() }));
}
function select(records: ParsedLogRecord[], params: LogQueryParams) {
  const unique = [...new Map(records.map(r => [r.logId, r])).values()];
  return unique.filter(r => !params.keyword || r.message.toLowerCase().includes(params.keyword.toLowerCase()))
    .slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 100));
}
export async function queryAppLogs(params: LogQueryParams = {}): Promise<ParsedLogRecord[]> {
  const records = [];
  for (const query of await queries(params)) records.push(...await readServiceLogWindow(query, queryWorkbenchServiceLogs));
  return select(records, params);
}
export async function queryBackendLogs(params: BackendLogQueryParams = {}, options: BackendNodeRequestOptions = {}): Promise<ParsedLogRecord[]> {
  const records = [];
  for (const query of await queries(params)) records.push(...await readServiceLogWindow(query, q => queryOntologyServiceLogs(q, options), options.signal));
  return select(records, params);
}
export async function getErrorSummary(params: LogQueryParams, options: BackendNodeRequestOptions = {}) {
  const records = [...await queryAppLogs({ ...params, level: "warn" }), ...await queryBackendLogs(params, options)];
  return extractErrors(records, params.limit ?? 100);
}
