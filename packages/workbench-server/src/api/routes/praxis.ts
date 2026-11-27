import { Router, type Request, type Response } from "express";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import type { AuthenticatedRequest } from "../../utils/request-identity.js";
import { proxyResponse, buildUpstreamHeaders } from "../utils/proxy.js";

const ALLOWED: Array<{ method: string; path: RegExp }> = [
  { method: "GET", path: /^runs$/ },
  { method: "GET", path: /^runs\/[^/]+$/ },
  { method: "GET", path: /^runs\/[^/]+\/case$/ },
  { method: "GET", path: /^inbox$/ },
  { method: "GET", path: /^subjects$/ },
  { method: "GET", path: /^steps\/[^/]+\/candidates$/ },
  { method: "GET", path: /^workflows\/[^/]+\/template$/ },
  { method: "POST", path: /^runs$/ },
  { method: "POST", path: /^runs\/[^/]+\/tick$/ },
  { method: "POST", path: /^runs\/[^/]+\/acts-on$/ },
  { method: "POST", path: /^runs\/[^/]+\/case\/(?:submit|fill|close)$/ },
  { method: "POST", path: /^steps\/[^/]+\/(?:decide|assign)$/ },
];

export function createPraxisRouter(
  upstreamBase = process.env.PRAXIS_UPSTREAM ?? "http://praxis:18600",
): Router {
  const praxisUpstream = upstreamBase.replace(/\/+$/, "");
  return Router().use(async (request: Request, response: Response) => {
    const path = request.path.replace(/^\/+/, "");
    if (!ALLOWED.some((entry) => entry.method === request.method && entry.path.test(path))) {
      response.status(404).json({ success: false, error: "Praxis route not found" });
      return;
    }

    const authenticated = request as AuthenticatedRequest;
    const requested = queryDomainId(request);
    const authenticatedDomain = authenticated.domainId?.trim() || null;
    const deploymentAdmin = authenticated.roles?.includes("superAdmin") === true;
    if (requested && authenticatedDomain && requested !== authenticatedDomain && !deploymentAdmin) {
      response.status(403).json({
        success: false,
        error: "The requested domain does not match the authenticated domain",
      });
      return;
    }
    const domainId = requested || authenticatedDomain;
    if (!domainId) {
      response.status(403).json({
        success: false,
        error: "domainId is required for a deployment administrator",
      });
      return;
    }

    const upstreamUrl = new URL(request.originalUrl, "http://workbench.local");
    upstreamUrl.pathname = `/${path}`;
    upstreamUrl.searchParams.delete("domainId");
    const target = `${praxisUpstream}${upstreamUrl.pathname}${upstreamUrl.search}`;
    try {
      // A preview's request carries its identity unchanged; Praxis write entries refuse it themselves.
      const preview = request.header(EXECUTION_CONTEXT_HEADER) === previewExecutionContextHeader;
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          ...buildUpstreamHeaders(request),
          "x-ontomato-domain-id": domainId,
          ...(preview && { [EXECUTION_CONTEXT_HEADER]: previewExecutionContextHeader }),
        },
        ...(request.method === "GET"
          ? {}
          : { body: JSON.stringify(request.body ?? {}) }),
        signal: AbortSignal.timeout(900_000),
      });
      await proxyResponse(upstream, response);
    } catch (error) {
      response.status(502).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function queryDomainId(request: Request): string | null {
  const value = request.query.domainId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
