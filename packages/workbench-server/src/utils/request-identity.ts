import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import type { RequestIdentity } from "@ontomato/contracts/identity";
import { Request } from "express";
import {buildBackendHeaders} from "./backend-client";
import { workbenchIdentity } from "../identity/installed";

export interface AuthenticatedRequest extends Request, RequestIdentity {
  token: string;
  apiKey: string;
  locale: string;
}

export function requireDomainId(identity: { domainId?: string | null }): string {
  return workbenchIdentity().requireDomainId(identity);
}

/** Preserve a caller's narrowing scope when a public Node capability calls Java. */
export function credentialsFromRequest(request:AuthenticatedRequest) {
  const {token,apiKey,locale}=request;
  const caller = request.header("X-Ontomato-Retrieval-Caller-Id");
  const execution = request.header(AGENT_EXECUTION_HEADER);
  const scope = {
    ...(caller && { "X-Ontomato-Retrieval-Caller-Id": caller }),
    ...(execution !== undefined && { [AGENT_EXECUTION_HEADER]: execution }),
  };
  return {
    token, apiKey, locale,
    ...((caller || execution !== undefined) && {
      headers: buildBackendHeaders(token, undefined, locale, apiKey, scope),
    }),
    // A preview arrives as the header its caller sends and stays here as a marker: only a request this caller then sends
    // to a business-data write entry carries it again, so every other call to Java travels as it would live.
    ...(request.header(EXECUTION_CONTEXT_HEADER) === previewExecutionContextHeader && { executionKind: "preview" as const }),
  };
}
