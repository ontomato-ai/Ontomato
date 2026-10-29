import { workbenchProduct } from "../../../../product/installed";
import type { LogSource, LogSourceProbeResult } from "@ontomato/contracts/observe";
import type { BackendNodeRequestOptions } from "./backend-node-client";
import { queryWorkbenchServiceLogs, queryOntologyServiceLogs, queryRuntimeServiceLogs } from "../service-logs";
import { getLogContext } from "../../../../logging/log-context";
export function listLogSources(): LogSource[] {
  return [{ sourceType: workbenchProduct().appLogSourceType, url: "/api/observe/logs", displayName: "Workbench", available: true },
    { sourceType: "backend-node-api", url: "/observe/logs", displayName: "Ontology", available: true },
    { sourceType: "agent-runtime", url: "/api/observe/runtime-logs", displayName: "Agent runtime", available: true }];
}
export async function probeLogSource(sourceType: LogSource["sourceType"], options: BackendNodeRequestOptions = {}): Promise<LogSourceProbeResult> {
  try {
    if (sourceType === workbenchProduct().appLogSourceType) await queryWorkbenchServiceLogs({ limit: 1 });
    else if (sourceType === "backend-node-api") await queryOntologyServiceLogs({ limit: 1 }, options);
    else if (sourceType === "agent-runtime") await queryRuntimeServiceLogs({ limit: 1 }, getLogContext()?.domainId);
    else throw new Error("Unknown log source");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Log store unavailable" }; }
}
export async function probeAllLogSources(options: BackendNodeRequestOptions = {}) {
  return Promise.all(listLogSources().map(async ({ sourceType }) => ({ sourceType, ...await probeLogSource(sourceType, options) })));
}
