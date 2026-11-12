/**
 * The capability code of the agent platform's own settings page ("智能体"). It is the code the old admin console used,
 * unchanged, so existing grants keep working. Skills and external MCP services are the ontology manager's and the system
 * settings' since 2026-11-12, under their own codes.
 */
export const AGENT_PAGE_PERMISSIONS = [
  "analysis-agent",
] as const;

/** The operations diagnosis page (the old console's observability page). */
export const OPS_DIAGNOSIS_PERMISSION = "observer";

/** An entry is shown when the user has any one of its permissions. Open source has no permission gate. */
export function anyPermission(can: (permission: string) => boolean, permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(permission));
}
