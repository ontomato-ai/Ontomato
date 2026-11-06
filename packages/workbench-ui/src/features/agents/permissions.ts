/**
 * The capability codes of the agent platform's own pages ("智能体" and "运维诊断"). They are the codes the old admin
 * console used, unchanged, so existing grants keep working: the console's pages now live in the function area, and its
 * declared permissions (the enterprise permission centre) still list exactly these codes.
 */
export const AGENT_PAGE_PERMISSIONS = [
  "analysis-agent",
  "mcp-service",
  "skill-management",
] as const;

/** The operations diagnosis page (the old console's observability page). */
export const OPS_DIAGNOSIS_PERMISSION = "observer";

/** An entry is shown when the user has any one of its permissions. Open source has no permission gate. */
export function anyPermission(can: (permission: string) => boolean, permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(permission));
}
