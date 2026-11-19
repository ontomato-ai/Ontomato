import type { RequestHandler } from "express";
import type { WorkbenchIdentity } from "./types";

let installed: WorkbenchIdentity | null = null;

export function installWorkbenchIdentity(identity: WorkbenchIdentity): void {
  installed = identity;
}

export function workbenchIdentity(): WorkbenchIdentity {
  if (!installed) throw new Error("Workbench identity is not installed");
  return installed;
}

/** Attachable as soon as route modules load; the concrete implementation is fetched at request time. */
export function requirePermission(keys: readonly string[]): RequestHandler {
  return (req, res, next) => {
    void workbenchIdentity().requirePermission(keys)(req, res, next);
  };
}

/** Verifies menu permissions inside a service call using the same edition boundary as `requirePermission`. */
export function assertPermission(
  identity: { token?: string; apiKey?: string },
  keys: readonly string[],
): Promise<void> {
  return workbenchIdentity().assertPermission(identity, keys);
}

export const guardMcpServiceManagement: RequestHandler = (req, res, next) => {
  void workbenchIdentity().guardMcpServiceManagement(req, res, next);
};
