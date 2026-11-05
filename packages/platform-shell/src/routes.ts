/**
 * The platform's route names and paths, in one leaf table.
 *
 * Both edition entries, the platform assembly, the shell and every application module read the same names and addresses
 * from here, so no application module has to import another one to learn where a page lives. This file is data only: it
 * imports nothing, so anything may depend on it without creating a cycle.
 */
export const platformRoutes = {
  layout: { name: "PlatformLayout", path: "/" },
  chat: { name: "Chat", path: "/agents/chat" },
  dashboards: { name: "Dashboards", path: "/agents/dashboards" },
  agents: { name: "AgentSettings", path: "/agents/settings" },
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
  governance: { name: "KnowledgeGovernance", path: "/governance/chat/:sessionId?" },
  feedback: { name: "Feedback", path: "/governance/feedback" },
  graph: { name: "LegacyGraph", path: "/browser/graph" },
  data: { name: "manager-data", path: "/browser/data/:className?" },
  ontology: { name: "OntologyHome", path: "/ontology" },
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
  knowledge: { name: "BusinessKnowledge", path: "/ontology/knowledge" },
  schedules: { name: "Schedules", path: "/schedules" },
  agentTasks: { name: "AgentSchedules", path: "/schedules/agents" },
  tasks: { name: "FunctionSchedules", path: "/schedules/functions" },
  task: { name: "FunctionSchedule", path: "/schedules/functions/:id" },
  permissions: { name: "Permissions", path: "/permissions" },
  models: { name: "ModelConfig", path: "/settings/model-config" },
  usage: { name: "ModelUsage", path: "/settings/model-config/usage" },
  providers: { name: "ModelProviders", path: "/settings/model-config/providers" },
  settings: { name: "SystemConfig", path: "/settings/system-config" },
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
