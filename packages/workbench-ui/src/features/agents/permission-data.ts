import { platformRoutes as routes } from "@ontomato/platform-shell/routes";

/**
 * The capability codes of the agent platform, as the permission centre declares them. They are the codes of the pages
 * the old admin console had, unchanged, so existing grants keep working (those pages now live in the function area).
 * This module is data only — no Vue, no browser APIs — so the application declaration can be generated without a browser;
 * the addresses come from the platform's route table, which is data only as well.
 */
export interface WorkbenchPermissionGroupData {
  key: string;
  /** The group is listed when the user has this code or any permission in it. */
  permission: string;
  titleKey: string;
  ownerApplication: "agents" | "operations";
}

export interface WorkbenchPermissionData {
  /** The entry is shown when the user has any one of these codes. */
  permissions: readonly string[];
  path: string;
  titleKey: string;
  /** The application whose page the entry opens: skills are the ontology manager's, external MCP the settings'. */
  ownerApplication: "agents" | "operations" | "ontology" | "settings";
  groupKey: string;
}

export const workbenchPermissionGroups = {
  appCapabilities: {
    key: "app-capabilities",
    permission: "application-management",
    titleKey: "nav.agentsAndSkills",
    ownerApplication: "agents",
  },
} satisfies Record<string, WorkbenchPermissionGroupData>;

export const workbenchPermissions = {
  businessAgents: {
    permissions: ["analysis-agent"],
    path: routes.agents.path,
    titleKey: "nav.businessAgents",
    ownerApplication: "agents",
    groupKey: "app-capabilities",
  },
  // The operations agent and its work live in operations diagnosis; observer opens that page.
  systemAgents: {
    permissions: ["observer"],
    path: routes.ops.path,
    titleKey: "nav.systemAgents",
    ownerApplication: "operations",
    groupKey: "app-capabilities",
  },
  skills: {
    permissions: ["skill-management"],
    path: routes.ontologySkills.path,
    titleKey: "nav.skills",
    ownerApplication: "ontology",
    groupKey: "app-capabilities",
  },
  mcpService: {
    permissions: ["mcp-service"],
    path: routes.externalMcp.path,
    titleKey: "nav.mcpService",
    ownerApplication: "settings",
    groupKey: "app-capabilities",
  },
} satisfies Record<string, WorkbenchPermissionData>;
