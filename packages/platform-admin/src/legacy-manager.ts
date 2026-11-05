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
  // The scheduled tasks of functions are the platform's now: one page lists every task.
  "/assets/tasks": routes.schedules.path,
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

/**
 * Where an old Manager address lands now: the old pages keep their mapping, and an address that is already one of the
 * platform's own is left as it is, so a current deep link is not sent back to a landing page.
 */
export function managerDestination(fullPath: string) {
  const separator = fullPath.indexOf("?");
  const path = separator < 0 ? fullPath : fullPath.slice(0, separator);
  const query = separator < 0 ? "" : fullPath.slice(separator);
  for (const [oldPath, newPath] of Object.entries(oldPages)) {
    if (path === oldPath || path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length) + query;
  }
  // A page's address may carry a parameter; a current deep link is recognised by its base address.
  const base = (value: string) => value.split("/:")[0]!;
  if (Object.values(routes).some((route) => path === base(route.path) || path.startsWith(base(route.path) + "/")))
    return path + query;
  return routes.ontology.path;
}
