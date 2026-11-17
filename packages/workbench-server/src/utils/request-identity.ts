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
  const caller=request.header("X-Ontomato-Retrieval-Caller-Id");
  return {token,apiKey,locale,...(caller?{headers:buildBackendHeaders(token,undefined,locale,apiKey,{"X-Ontomato-Retrieval-Caller-Id":caller})}:{})};
}
