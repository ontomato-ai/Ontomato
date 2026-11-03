/** Source data shared by the browser navigation and application permission declaration. No browser imports. */
export interface AdminGroupData {
  key: string;
  titleKey: string;
  permission: string;
  ownerApplication: "platform" | "workbench";
  icon: string;
  target?: "ontology-manager";
}

export interface AdminMenuItemData {
  permissions: readonly string[];
  path: string;
  titleKey: string;
  descriptionKey: string;
  ownerApplication: "platform" | "workbench";
  icon: string;
  groupKey: string;
}

/** Shared tabs and menu items; each app lists the ones it uses explicitly in the original order. */
export const adminGroupData = {
  dataAssets: {
    key: "data-assets",
    titleKey: "nav.ontologyManager",
    permission: "ontology-modeling",
    ownerApplication: "platform",
    icon: "Database",
    target: "ontology-manager",
  },
  appCapabilities: {
    key: "app-capabilities",
    titleKey: "nav.agentsAndSkills",
    permission: "application-management",
    ownerApplication: "workbench",
    icon: "Blocks",
  },
  platformManagement: {
    key: "platform-management",
    titleKey: "nav.systemManagement",
    permission: "system-management",
    ownerApplication: "platform",
    icon: "Monitor",
  },
} satisfies Record<string, AdminGroupData>;

export const adminMenuItemData = {
  businessAgents: {
    permissions: ["analysis-agent"],
    ownerApplication: "workbench",
    path: "/admin/analysis",
    titleKey: "nav.businessAgents",
    descriptionKey: "navDescription.businessAgents",
    icon: "Blocks",
    groupKey: "app-capabilities",
  },
  systemAgents: {
    permissions: ["observer"],
    ownerApplication: "workbench",
    path: "/admin/system-agents",
    titleKey: "nav.systemAgents",
    descriptionKey: "navDescription.systemAgents",
    icon: "Bot",
    groupKey: "app-capabilities",
  },
  mcpService: {
    permissions: ["mcp-service"],
    ownerApplication: "workbench",
    path: "/admin/mcp-service",
    titleKey: "nav.mcpService",
    descriptionKey: "navDescription.mcpService",
    icon: "Network",
    groupKey: "app-capabilities",
  },
  skills: {
    permissions: ["skill-management"],
    ownerApplication: "workbench",
    path: "/admin/skills",
    titleKey: "nav.skills",
    descriptionKey: "navDescription.skills",
    icon: "Puzzle",
    groupKey: "app-capabilities",
  },
  modelConfig: {
    permissions: ["system-config"],
    ownerApplication: "platform",
    path: "/admin/model-config",
    titleKey: "nav.modelConfig",
    descriptionKey: "navDescription.modelConfig",
    icon: "Cpu",
    groupKey: "platform-management",
  },
  systemConfig: {
    permissions: ["system-config"],
    ownerApplication: "platform",
    path: "/admin/system-config",
    titleKey: "nav.systemConfig",
    descriptionKey: "navDescription.systemConfig",
    icon: "ServerCog",
    groupKey: "platform-management",
  },
  feedbackRecords: {
    permissions: ["audit-logs"],
    ownerApplication: "platform",
    path: "/admin/feedback-records",
    titleKey: "nav.feedbackRecords",
    descriptionKey: "navDescription.feedbackRecords",
    icon: "MessageSquare",
    groupKey: "platform-management",
  },
} satisfies Record<string, AdminMenuItemData>;
