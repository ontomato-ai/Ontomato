function normalizeInitialRoute(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

// Location parameters from the main system's old visual modeling entry form the modeling address query as-is.
function visualModelingQuery(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of ["focus", "id", "back"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/**
 * Where the root address (`#/` or no hash) lands: the view passed by the main system's old launch links
 * (`?view=...`), then the deployment's initial route, then the ontology graph. Any other hash is a route of its own.
 */
export function serviceHome(initialRoute: string) {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "data-browser") return "/data";
  if (view === "assets") return "/assets/metrics";
  if (view === "knowledge") return "/knowledge";
  if (view === "visual-modeling") return `/visual-modeling${visualModelingQuery(params)}`;
  return initialRoute ? normalizeInitialRoute(initialRoute) : "/playground";
}
