/**
 * The platform's route names and paths, in one leaf table.
 *
 * Both edition entries, the platform assembly, the shell and every application module read the same names and addresses
 * from here, so no application module has to import another one to learn where a page lives. This file is data only: it
 * imports nothing, so anything may depend on it without creating a cycle.
 */
export const platformRoutes = {
  layout: { name: "PlatformLayout", path: "/" },
  personalWorkspace: { name: "PersonalWorkspace", path: "/workspace" },
  /** The platform's home: everyone's starting point, with their favourites, dashboards and every application. */
  home: { name: "Home", path: "/home" },
  chat: { name: "Chat", path: "/agents/chat" },
  /** The dashboards are an application of their own: the charts and datasets conversations add to. */
  dashboards: { name: "Dashboards", path: "/dashboards" },
  agents: { name: "AgentSettings", path: "/agents/settings" },
  /**
   * The settings screens: a new agent and one agent's editor. The fixed addresses come before the parameter, so
   * `/agents/settings/new` is the new agent and never an agent whose id is "new"; the library's old addresses
   * (capabilities, skills, mcp) now forward to the skills and the external MCP services, which are the platform's.
   */
  agentSettingsNew: { name: "AgentSettingsNew", path: "/agents/settings/new" },
  agentSettingsCapabilities: { name: "AgentSettingsCapabilities", path: "/agents/settings/capabilities" },
  agentSettingsSkills: { name: "AgentSettingsSkills", path: "/agents/settings/skills" },
  agentSettingsMcp: { name: "AgentSettingsMcp", path: "/agents/settings/mcp" },
  /** The models of the ontology service agents the agent platform runs on, at the foot of the settings' column. */
  agentModels: { name: "AgentModels", path: "/agents/settings/models" },
  agentSettings: { name: "AgentSettingsAgent", path: "/agents/settings/:agentId" },
  ops: { name: "Operations", path: "/ops" },
  diagnosis: { name: "ObserveDiagnosis", path: "/ops/diagnosis" },
  opsKnowledge: { name: "ObserveKnowledge", path: "/ops/knowledge" },
  turn: { name: "ObserveTurn", path: "/ops/turn" },
  turnDetail: { name: "ObserveTurnDetail", path: "/ops/turn/:turnKey" },
  logs: { name: "ObserveLiveLogs", path: "/ops/live-logs" },
  test: { name: "ObserveTest", path: "/ops/test" },
  results: { name: "ObserveResults", path: "/ops/results" },
  cases: { name: "ObserveCases", path: "/ops/cases" },
  caseDetail: { name: "ObserveAutoTestCaseDetail", path: "/ops/autotest/runs/:runId/cases/:caseId" },
  dsl: { name: "ObserveDsl", path: "/ops/dsl" },
  opsModel: { name: "ObserveModel", path: "/ops/model" },
  governance: { name: "KnowledgeGovernance", path: "/governance/chat/:sessionId?" },
  /** 应用构建: the workspace in the address, the open conversation as `?sessionId=`. */
  appBuilder: { name: "AppBuilder", path: "/app-builder/:workspaceId?" },
  feedback: { name: "Feedback", path: "/governance/feedback" },
  /** The models of the knowledge governance agents, at the foot of the application's column. */
  governanceModels: { name: "GovernanceModels", path: "/governance/models" },
  data: { name: "manager-data", path: "/browser/data/:className?" },
  objectView: { name: "manager-object-view", path: "/browser/views/:className" },
  objectViewEditor: { name: "manager-object-view-editor", path: "/ontology/objects/:className/view" },
  ontology: { name: "OntologyHome", path: "/ontology" },
  ontologyCapabilities: { name: "OntologyCapabilities", path: "/ontology/capabilities" },
  ontologySkills: { name: "OntologySkills", path: "/ontology/skills" },
  /** One skill, read as its package. */
  ontologySkill: { name: "OntologySkill", path: "/ontology/skills/:skillId" },
  ontologyMcp: { name: "OntologyMcp", path: "/ontology/mcp" },
  playground: { name: "OntologyGraph", path: "/ontology/playground" },
  objects: { name: "Objects", path: "/ontology/objects" },
  object: { name: "manager-object", path: "/ontology/objects/:className" },
  attributes: { name: "Attributes", path: "/ontology/attributes" },
  relations: { name: "Relations", path: "/ontology/relations" },
  relation: { name: "manager-relation", path: "/ontology/relations/:relationship" },
  modeling: { name: "VisualModeling", path: "/ontology/visual-modeling" },
  metrics: { name: "Metrics", path: "/ontology/assets/metrics" },
  metric: { name: "Metric", path: "/ontology/assets/metrics/:id" },
  functions: { name: "Functions", path: "/ontology/assets/functions" },
  function: { name: "Function", path: "/ontology/assets/functions/:id" },
  actions: { name: "Actions", path: "/ontology/assets/actions" },
  action: { name: "Action", path: "/ontology/assets/actions/:id" },
  workflows: { name: "Workflows", path: "/ontology/assets/workflows" },
  capabilityMap: { name: "CapabilityMap", path: "/ontology/assets/capability-map" },
  knowledge: { name: "BusinessKnowledge", path: "/ontology/knowledge" },
  /** The models of the ontology modeling agents, at the foot of the ontology manager's menu. */
  ontologyModels: { name: "OntologyModels", path: "/ontology/models" },
  /** One page for every scheduled task of the platform. */
  schedules: { name: "Schedules", path: "/schedules" },
  /** The agent platform's own scheduled tasks: this agent's, listed by the same page. */
  agentSchedules: { name: "AgentSchedules", path: "/agents/schedules" },
  /** The permissions' own address forwards to its first page the account may open. */
  permissions: { name: "Permissions", path: "/permissions" },
  members: { name: "PermissionMembers", path: "/permissions/members" },
  roles: { name: "PermissionRoles", path: "/permissions/roles" },
  policies: { name: "PermissionPolicies", path: "/permissions/policies" },
  organization: { name: "PermissionOrganization", path: "/permissions/organization" },
  /**
   * The system settings' pages. The addresses of the former parent pages (model config, system config, records) forward
   * to their first page; every page below is one of the application's column.
   */
  models: { name: "ModelConfig", path: "/settings/model-config" },
  usage: { name: "ModelUsage", path: "/settings/model-config/usage" },
  providers: { name: "ModelProviders", path: "/settings/model-config/providers" },
  settings: { name: "SystemConfig", path: "/settings/system-config" },
  /** The external MCP services agents may call, registered once for the platform. */
  externalMcp: { name: "ExternalMcpServices", path: "/settings/external-mcp" },
  publishedMcp: { name: "PublishedMcpServices", path: "/settings/mcp-services" },
  general: { name: "GeneralSettings", path: "/settings/system-config/general" },
  adapters: { name: "DataAdapters", path: "/settings/system-config/data-adapters" },
  license: { name: "Authorization", path: "/settings/system-config/authorization" },
  records: { name: "Records", path: "/settings/records" },
  audit: { name: "AuditLog", path: "/settings/records/audit-log" },
  monitor: { name: "SystemMonitor", path: "/settings/records/system-monitor" },
  login: { name: "Login", path: "/login" },
  callback: { name: "AuthCallback", path: "/auth/callback" },
  superAdmin: { name: "SuperAdmin", path: "/super-admin" },
} as const;

/** The address of a route key, for redirects that name a destination rather than a record. */
export function platformPath(key: keyof typeof platformRoutes): string {
  return platformRoutes[key].path;
}
