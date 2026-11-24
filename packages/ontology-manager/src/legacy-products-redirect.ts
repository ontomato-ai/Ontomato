import { panelAddress } from "@ontomato/contracts/panel-host";
import type { ProductAsset } from "@ontomato/contracts/product-assets";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";

type RouteValues = Readonly<Record<string, unknown>>;

const PROJECTIONS_PATH = "/ontology/projections";
const PROJECTION_DETAIL_PATH = "/ontology/projections/detail";
const PANELS_PATH = "/ontology/panels";
const PANEL_DETAIL_PATH = "/ontology/panels/detail";
const APPLICATIONS_PATH = "/ontology/applications";
const APPLICATION_DETAIL_PATH = "/ontology/applications/detail";
const AGENTS_PATH = routes.ontologyAgents.path;

type TargetSection = "projections" | "applications" | "agents" | "panels";

const PROJECTION_KINDS = new Set([
  "projection",
  "projections",
  "object-projection",
  "collection-view",
  "metric-widget",
  "action-view",
  "object-view",
]);

const APPLICATION_KINDS = new Set([
  "application",
  "applications",
]);

const AGENT_KINDS = new Set([
  "agent",
  "agents",
  "profile",
  "agent-profile",
]);

function firstQueryString(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function stripPrefix(id: string, prefixes: readonly string[]): string | undefined {
  for (const prefix of prefixes) {
    if (id.startsWith(prefix) && id.length > prefix.length) {
      return id.slice(prefix.length);
    }
  }
  return undefined;
}

function classifyProductKind(rawKind?: string): TargetSection {
  const kind = rawKind?.trim().toLowerCase() ?? "";
  if (PROJECTION_KINDS.has(kind)) return "projections";
  if (APPLICATION_KINDS.has(kind)) return "applications";
  if (AGENT_KINDS.has(kind)) return "agents";
  return "panels";
}

/** Extract the target asset ID from a legacy `/ontology/products/:productId` or `?id=` route. */
export function legacyProductIdFromRoute(params: RouteValues, query: RouteValues): string {
  return firstQueryString(params.productId) || firstQueryString(query.id);
}

/** Resolve a legacy `/ontology/products` directory or `?create=<kind>` address to its new product-layer page. */
export function legacyProductsDirectoryTarget(query: RouteValues): string {
  const section = classifyProductKind(firstQueryString(query.create) || firstQueryString(query.kind));
  const search = firstQueryString(query.search);
  const path = section === "projections"
    ? PROJECTIONS_PATH
    : section === "applications"
      ? APPLICATIONS_PATH
      : section === "agents"
        ? AGENTS_PATH
        : PANELS_PATH;
  // projections, applications and panels declare `search` as deepLink; agent-settings does not.
  return search && section !== "agents" ? panelAddress(path, { search }) : path;
}

/** Resolve a loaded legacy product asset to its new product-layer destination with `selected`. */
export function legacyProductAssetTarget(asset: ProductAsset): string {
  if (asset.document.kind === "application") {
    const appId = asset.document.applicationId.trim()
      || stripPrefix(asset.id, ["platform-application-"])
      || asset.id;
    return panelAddress(APPLICATION_DETAIL_PATH, { selected: appId });
  }
  if (asset.document.kind === "agent-profile") {
    const agentId = asset.document.agentId.trim()
      || stripPrefix(asset.id, ["default-agent-profile-", "platform-agent-"])
      || asset.id;
    return panelAddress(AGENTS_PATH, { selected: agentId });
  }
  const section = classifyProductKind(asset.document.kind);
  return panelAddress(section === "projections" ? PROJECTION_DETAIL_PATH : PANEL_DETAIL_PATH, { selected: asset.id });
}

/**
 * Fallback locator when a legacy asset cannot be read (e.g. 403/404): never blocks or enforces access itself,
 * leaving authorization and missing-object presentation to the destination page and object owner.
 */
export function legacyProductIdFallbackTarget(id: string, query: RouteValues): string {
  const mirroredAppId = stripPrefix(id, ["platform-application-"]);
  if (mirroredAppId) return panelAddress(APPLICATION_DETAIL_PATH, { selected: mirroredAppId });

  const mirroredAgentId = stripPrefix(id, ["default-agent-profile-", "platform-agent-"]);
  if (mirroredAgentId) return panelAddress(AGENTS_PATH, { selected: mirroredAgentId });

  const section = classifyProductKind(firstQueryString(query.kind));
  if (section === "projections") return panelAddress(PROJECTION_DETAIL_PATH, { selected: id });
  if (section === "applications") return panelAddress(APPLICATION_DETAIL_PATH, { selected: id });
  if (section === "agents") return panelAddress(AGENTS_PATH, { selected: id });
  return panelAddress(PANEL_DETAIL_PATH, { selected: id });
}
