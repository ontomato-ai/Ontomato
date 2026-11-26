import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { currentProductRows } from "../../infrastructure/product-current";
import { isPresetAgentKind, presetAgentDefinitions } from "../assistant/preset-definitions";
import { assistantStore } from "../assistant/store";

export interface PolicyCatalogOption {
  id: string;
  label: string;
  description?: string;
}

export interface PolicyWorkbenchCatalog {
  panels: PolicyCatalogOption[];
  projections: PolicyCatalogOption[];
  components: PolicyCatalogOption[];
  agents: PolicyCatalogOption[];
}

function localizedName(definition: Record<string, unknown>, id: string, locale?: string): string {
  const names = definition.names;
  if (names && typeof names === "object" && !Array.isArray(names)) {
    const map = names as Record<string, unknown>;
    const preferred = locale && typeof map[locale] === "string" && map[locale].trim() ? map[locale].trim() : null;
    if (preferred) return preferred;
    if (typeof map.en === "string" && map.en.trim()) return map.en.trim();
    for (const value of Object.values(map)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const direct = typeof definition.name === "string" && definition.name.trim() ? definition.name.trim() : null;
  if (direct) return direct;
  const content = definition.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const messages = (content as Record<string, unknown>).messages;
    if (messages && typeof messages === "object" && !Array.isArray(messages)) {
      const locales = messages as Record<string, unknown>;
      const pack = (locale && locales[locale]) ?? locales.en ?? Object.values(locales)[0];
      if (pack && typeof pack === "object" && !Array.isArray(pack)) {
        const panelName = (pack as Record<string, unknown>)["panel.name"];
        if (typeof panelName === "string" && panelName.trim()) return panelName.trim();
      }
    }
  }
  return id;
}

function descriptionText(definition: Record<string, unknown>): string | undefined {
  const direct = typeof definition.description === "string" && definition.description.trim()
    ? definition.description.trim()
    : undefined;
  return direct;
}

/**
 * Reads Workbench-owned object catalogs in the current domain so the enterprise policy form
 * can present human-readable options without the Java authorization module reverse-querying Workbench.
 */
export async function loadPolicyWorkbenchCatalog(
  domainId: string,
  locale?: string,
): Promise<PolicyWorkbenchCatalog> {
  return (await readPolicyWorkbenchObjects(domainId, locale)).catalog;
}

type ProductCatalogRow = { id: string; definition: Record<string, unknown>; owner_id: string | null };

export async function readPolicyWorkbenchObjects(domainId: string, locale?: string, includeDistribution = false) {
  const pool = getPostgresPool();
  const productRows = (kind: "panel" | "projection") => pool.query<ProductCatalogRow & { fixed: boolean }>(
    `SELECT id, definition, owner_id, domain_id IS NULL AS fixed
     FROM ${currentProductRows(kind, { domainWhere: "p.domain_id = $1", includeBuiltins: includeDistribution })} AS products
     ORDER BY id ASC`, [domainId],
  );
  const [panelRows, projectionRows, componentRows, agents] = await Promise.all([
    productRows("panel"),
    productRows("projection"),
    pool.query<ProductCatalogRow>(
      `SELECT id, definition, owner_id FROM ${t("domain_components")}
       WHERE domain_id = $1
       ORDER BY id ASC`,
      [domainId],
    ),
    assistantStore.channelAgents(domainId),
  ]);

  const toOptions = (rows: { id: string; definition: Record<string, unknown> }[]): PolicyCatalogOption[] =>
    rows
      .map(row => {
        const def = row.definition && typeof row.definition === "object" ? row.definition : {};
        const desc = descriptionText(def);
        return {
          id: row.id,
          label: localizedName(def, row.id, locale),
          ...(desc ? { description: desc } : {}),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const catalog: PolicyWorkbenchCatalog = {
    panels: toOptions(panelRows.rows),
    projections: toOptions(projectionRows.rows),
    components: toOptions(componentRows.rows),
    agents: agents.map(agent => ({
      id: agent.id,
      label: agent.name?.trim() || agent.id,
      ...(agent.description?.trim() ? { description: agent.description.trim() } : {}),
    })),
  };
  const ownerIds = {
    PANEL: new Map(panelRows.rows.map(row => [row.id, row.owner_id])),
    PROJECTION: new Map(projectionRows.rows.map(row => [row.id, row.owner_id])),
    COMPONENT: new Map(componentRows.rows.map(row => [row.id, row.owner_id])),
    AGENT: new Map(agents.map(agent => [agent.id, agent.owner_id])),
  };
  const presetAgentIds = new Set<string>();
  if (includeDistribution) {
    for (const agent of Object.values(presetAgentDefinitions)) {
      catalog.agents.push({ id: `preset:${agent.kind}`, label: agent.name });
    }
  }
  for (const agent of agents) {
    if (isPresetAgentKind(agent.kind)) presetAgentIds.add(agent.id);
  }
  const fixedProductIds = {
    PANEL: new Set(panelRows.rows.filter(row => row.fixed).map(row => row.id)),
    PROJECTION: new Set(projectionRows.rows.filter(row => row.fixed).map(row => row.id)),
  };
  return { catalog, ownerIds, presetAgentIds, fixedProductIds };
}
