/**
 * The capability codes of the agent platform, as the permission centre declares them. They are the codes of the pages
 * the old admin console had, unchanged, so existing grants keep working (those pages now live in the function area).
 * This module is data only — no Vue, no browser APIs — so the application declaration can be generated without a browser.
 */
export interface WorkbenchPermissionGroupData {
  key: string;
  /** The group is listed when the user has this code or any permission in it. */
  permission: string;
  titleKey: string;
  ownerApplication: "workbench";
}

export interface WorkbenchPermissionData {
  /** The entry is shown when the user has any one of these codes. */
  permissions: readonly string[];
  path: string;
  titleKey: string;
  ownerApplication: "workbench";
  groupKey: string;
}

export const workbenchPermissionGroups = {
  appCapabilities: {
    key: "app-capabilities",
    permission: "application-management",
    titleKey: "nav.agentsAndSkills",
    ownerApplication: "workbench",
  },
} satisfies Record<string, WorkbenchPermissionGroupData>;

export const workbenchPermissions = {
  businessAgents: {
    permissions: ["analysis-agent"],
    path: "/chat?feature=agents",
    titleKey: "nav.businessAgents",
    ownerApplication: "workbench",
    groupKey: "app-capabilities",
  },
  // The operations agent and its work live in operations diagnosis; observer opens that page.
  systemAgents: {
    permissions: ["observer"],
    path: "/observe",
    titleKey: "nav.systemAgents",
    ownerApplication: "workbench",
    groupKey: "app-capabilities",
  },
  skills: {
    permissions: ["skill-management"],
    path: "/chat?feature=agents&tab=capabilities",
    titleKey: "nav.skills",
    ownerApplication: "workbench",
    groupKey: "app-capabilities",
  },
  mcpService: {
    permissions: ["mcp-service"],
    path: "/chat?feature=agents&tab=capabilities",
    titleKey: "nav.mcpService",
    ownerApplication: "workbench",
    groupKey: "app-capabilities",
  },
} satisfies Record<string, WorkbenchPermissionData>;
