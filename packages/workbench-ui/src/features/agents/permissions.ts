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

/**
 * The tabs of the agents page. Both tabs read and write the agent definitions and the operations agent's model, which
 * the server guards with analysis-agent (the observer code opens operations diagnosis, not the agent definitions), so the
 * agents tab follows that code; the library follows the code of each kind of capability.
 */
export const AGENT_TAB_PERMISSIONS = {
  agents: ["analysis-agent"],
  capabilities: ["skill-management", "mcp-service"],
} as const;

/** An entry is shown when the user has any one of its permissions. Open source has no permission gate. */
export function anyPermission(can: (permission: string) => boolean, permissions: readonly string[]): boolean {
  return permissions.some((permission) => can(permission));
}

/** Whether one tab of the agents page is shown: its own permissions, or the whole tab set when the page has one tab left. */
export function showsAgentTab(
  can: (permission: string) => boolean,
  tab: keyof typeof AGENT_TAB_PERMISSIONS,
): boolean {
  return anyPermission(can, AGENT_TAB_PERMISSIONS[tab]);
}
