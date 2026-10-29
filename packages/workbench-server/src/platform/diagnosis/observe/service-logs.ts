import { LogQueryError, parseLine } from "@ontomato/service-logging";
import { serviceLogPageSchema, type ServiceLogPage, type ServiceLogQuery, type ServiceLogRecord } from "@ontomato/contracts/service-logging";
import type { ParsedLogRecord } from "@ontomato/contracts/observe";
import { getWorkbenchLogStore } from "../../../infrastructure/service-logs";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { workbenchProduct } from "../../../product/installed";
import { backendGet } from "../../../utils/backend-client";
import { getApiConfig } from "../../../config/data-query-api";
import type { BackendNodeRequestOptions } from "./log-sources/backend-node-client";

export const queryWorkbenchServiceLogs = (query: unknown): Promise<ServiceLogPage> => getWorkbenchLogStore().query(query);
export function observedRecord(record: ServiceLogRecord, service: string): ParsedLogRecord {
  const event = parseLine(record.line);
  if (!event) throw new Error("Service log line violates the shared contract");
  return {
    source: service === "ontology" ? "backend" : service === "agent-runtime" ? "agent-runtime" : workbenchProduct().logSource,
    time: record.time, level: record.level === "TRACE" ? "debug" : record.level === "FATAL" ? "error" : record.level.toLowerCase() as ParsedLogRecord["level"],
    correlationId: record.correlationId ?? undefined, runId: record.runId ?? undefined,
    domainId: record.domainId ?? undefined, sessionId: record.sessionId ?? undefined,
    context: record.module, backendNodeId: record.instanceId ?? undefined, logId: record.id,
    message: event.message, error: event.stack ?? undefined, durationMs: event.durationMs,
  };
}
export async function queryOntologyServiceLogs(query: ServiceLogQuery, options: BackendNodeRequestOptions = {}, baseUrl = getApiConfig().baseUrl): Promise<ServiceLogPage> {
  if (!baseUrl) throw new Error("Ontology log service is not configured");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const response = await backendGet("/observe/logs", `${baseUrl.replace(/\/$/, "")}/observe/logs?${params}`, { ...options, retries: 1 });
  const page = serviceLogPageSchema.parse(JSON.parse(response.text));
  if (page.service !== "ontology") throw new Error("Ontology log endpoint returned another service");
  return page;
}
export async function queryRuntimeServiceLogs(query: Record<string, unknown>, domainId?: string): Promise<ServiceLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  let response: unknown;
  try { response = await new RuntimeClient(domainId).request(`/v1/logs?${params}`); }
  catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 503) throw new LogQueryError(503, "LOG_STORE_UNAVAILABLE", "Runtime log store is unavailable");
    throw error;
  }
  const page = serviceLogPageSchema.parse(response);
  if (page.service !== "agent-runtime") throw new Error("Runtime log endpoint returned another service");
  return page;
}

export interface LogTimeWindow { startTime?: string; endTime?: string }
export async function readServiceLogWindow(query: ServiceLogQuery, read: (query: ServiceLogQuery) => Promise<ServiceLogPage>, signal?: AbortSignal): Promise<ParsedLogRecord[]> {
  const records = new Map<string, ParsedLogRecord>();
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await read({ ...query, cursor, limit: 200 });
    for (const record of page.records) records.set(record.id, observedRecord(record, page.service));
    cursor = page.nextCursor ?? undefined;
    query = { ...query, ...page.window };
  } while (cursor);
  return [...records.values()];
}
