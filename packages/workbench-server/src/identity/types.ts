import type { Request, RequestHandler } from "express";
import type { RequestIdentity } from "@ontomato/contracts/identity";

/** Data engine online ticket verification result. Task attribution, MCP, and autotest never share this one return value. */
export interface VerifiedOnlineCredential {
  id: string;
  loginCode?: string | null;
  userName?: string | null;
  roles?: string[] | null;
  domainId?: string | null;
  domainName?: string | null;
}

/** Downstream credentials of a scheduled run, in the shape online requests carry them. */
export interface ScheduledRunCredentials {
  token?: string;
  apiKey?: string;
}

export interface SkillResourceDomainResult {
  ok: true;
  domainId: string;
  token?: string;
  apiKey?: string;
}

export interface SkillResourceDomainFailure {
  ok: false;
  status: 401 | 403 | 502;
  code: string;
  error: string;
}

/**
 * Real identity differences between the editions. Shared routes only call members here and never branch on edition.
 * Calling before installation is an assembly error and never degrades into an anonymous principal.
 */
export interface WorkbenchIdentity {
  /** Enterprise verifies the ticket; OSS writes the fixed system/default. Proxies mounted before `/api` never pass through it. */
  authenticate: RequestHandler;
  /**
   * Called before every task run. Online entries pass in already-verified identity; offline tasks only have the token saved on the task row.
   * Enterprise: verified identity is compared with the task row directly, otherwise the token is verified again before comparing, and an attribution mismatch is rejected;
   * OSS keeps the userId/domainId on the task row, verifying no ticket and comparing nothing.
   */
  confirmTaskOwner(
    task: { userId: string; domainId: string; token?: string },
    verifiedIdentity?: Pick<RequestIdentity, "userId" | "domainId">
  ): Promise<void>;
  /**
   * Scheduled tasks run while their owner is offline, with a credential the server keeps per owner and domain.
   * Enterprise: exchanges the caller's own login token for a new internal API Key of the login's user and domain,
   * which ends the previous one; without a login token (e.g. a request made with an API Key) it answers 403.
   * OSS has no credential and returns null.
   */
  issueScheduledCredential(caller: { token?: string; apiKey?: string }): Promise<string | null>;
  /**
   * The credentials one scheduled run uses, from the kept credential. Enterprise verifies that the internal API Key
   * still authenticates as the owner and returns it, or null when it does not; an unreachable verifier throws.
   * OSS ignores the (null) credential and returns what its requests carry: the deployment's query key.
   */
  resolveScheduledCredential(
    owner: { userId: string; domainId: string },
    credential: string | null
  ): Promise<ScheduledRunCredentials | null>;
  /** Enterprise verifies the tk and the domain must equal this run; OSS uses the domainId from run parameters, defaulting to default. */
  resolveAutotestActor(input: {
    token: string;
    domainId?: string | null;
  }): Promise<{ userId: string; domainId: string }>;
  /**
   * Enterprise: the API Key in tool parameters wins, then the API Key in the request, then the token.
   * OSS never reads these credentials and stays on the fixed system/default, nor writes the caller's API Key into the task.
   */
  resolveMcpCaller(
    req: Request,
    toolApiKey?: string
  ): Promise<{ userId: string; userName?: string; domainId: string; token?: string; apiKey?: string }>;
  /** `/api/skills/resources`. Enterprise verifies credentials first then requires the domain; OSS uses default directly. */
  resolveSkillResourceDomain(req: Request): Promise<SkillResourceDomainResult | SkillResourceDomainFailure>;
  /** Knowledge governance and skill writes. OSS allows all; enterprise goes through menu permissions. */
  requirePermission(keys: readonly string[]): RequestHandler;
  /** MCP service management routes. Their error copy differs from menu permissions, so they cannot merge into requirePermission. */
  guardMcpServiceManagement: RequestHandler;
  /** Diagnosis routes. Enterprise requires the domain first, then observer; OSS allows all. */
  observeAccess: RequestHandler;
  /** Verifies that the caller has access to diagnosis/observe capabilities. Enterprise requires domain and observer permission; OSS allows all. */
  assertObserveAccess(identity: { domainId?: string; token?: string; apiKey?: string }): Promise<void>;
  /**
   * Enterprise answers 403 when the domain is missing. OSS always returns default and never adopts the domain from request input,
   * preventing a self-declared request domain from splitting the single-domain storage.
   */
  requireDomainId(identity: { domainId?: string | null }): string;
  /**
   * Added only to Node's own model settings read (`resolveModelForRole`), next to the caller's credential; never to
   * other backend calls or the proxy. Enterprise sends its model runtime service credential; OSS sends nothing.
   */
  modelSettingsReadHeaders: Readonly<Record<string, string>>;
}
