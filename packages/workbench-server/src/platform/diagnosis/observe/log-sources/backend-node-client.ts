import type { BackendNodeConfig, LogSourceConfig } from "@ontomato/contracts/observe";
import { getApiConfig } from "../../../../config/data-query-api";
export interface BackendNodeRequestOptions {
  token?: string;
  apiKey?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface BackendNodeLogLine {
  nodeId?: string;
  line: string;
}

export interface BackendTailStream {
  close: () => void;
}

export function resolveBackendNodeBaseUrl(
  cfg: LogSourceConfig,
  backendNodeId?: string
): string | null {
  const configured = backendNodeId ? cfg.backendNodes.find(node => node.nodeId === backendNodeId) : undefined;
  const baseUrl = configured?.baseUrl || getApiConfig().baseUrl || "";
  return baseUrl || null;
}

export function listBackendTailNodes(cfg: LogSourceConfig): BackendNodeConfig[] {
  if (cfg.backendNodes.length > 0) {
    return cfg.backendNodes;
  }

  const baseUrl = getApiConfig().baseUrl;
  return baseUrl ? [{ nodeId: "default", baseUrl }] : [];
}
