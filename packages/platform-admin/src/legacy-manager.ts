import { platformRoutes as routes } from "@ontomato/platform-shell/routes";

/** Translate only the Manager document's old addresses. Workbench /admin links have different meanings. */
const oldPages: Record<string, string> = {
  "/playground": routes.playground.path,
  "/objects": routes.objects.path,
  "/relations": routes.relations.path,
  "/attributes": routes.attributes.path,
  "/data": "/browser/data",
  "/assets/actions": routes.actions.path,
  "/assets/functions": routes.functions.path,
  "/assets/tasks": routes.tasks.path,
  "/assets/metrics": routes.metrics.path,
  "/visual-modeling": routes.modeling.path,
  "/admin/ontology/visual-modeling": routes.modeling.path,
  "/knowledge/feedback": routes.feedback.path,
  "/knowledge": routes.knowledge.path,
  "/knowledge-governance": "/governance/chat",
  "/admin/model-config": routes.models.path,
  "/admin/system-config": routes.settings.path,
  "/admin/records": routes.records.path,
  "/admin/license": routes.license.path,
  "/admin/system-monitor": routes.monitor.path,
  "/admin/audit-log": routes.audit.path,
  "/admin/permissions": routes.permissions.path,
  "/admin": routes.ontology.path + "?section=admin",
  "/login": routes.login.path,
  "/auth/callback": routes.callback.path,
  "/super-admin": routes.superAdmin.path,
};

export function managerDestination(fullPath: string) {
  const separator = fullPath.indexOf("?");
  const path = separator < 0 ? fullPath : fullPath.slice(0, separator);
  const query = separator < 0 ? "" : fullPath.slice(separator);
  for (const [oldPath, newPath] of Object.entries(oldPages)) {
    if (path === oldPath || path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length) + query;
  }
  return routes.ontology.path;
}
