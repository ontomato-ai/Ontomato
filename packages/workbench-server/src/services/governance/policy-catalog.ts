import { BUILTIN_PRODUCT_ID_PREFIX } from "@ontomato/contracts/product-record-id";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
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
  const pool = getPostgresPool();
  const [panelRows, projectionRows, componentRows, agents] = await Promise.all([
    pool.query<{ id: string; definition: Record<string, unknown> }>(
      `SELECT id, definition FROM ${t("product_panels")}
       WHERE domain_id = $1 AND NOT starts_with(id, $2)
       ORDER BY id ASC`,
      [domainId, BUILTIN_PRODUCT_ID_PREFIX],
    ),
    pool.query<{ id: string; definition: Record<string, unknown> }>(
      `SELECT id, definition FROM ${t("product_projections")}
       WHERE domain_id = $1 AND NOT starts_with(id, $2)
       ORDER BY id ASC`,
      [domainId, BUILTIN_PRODUCT_ID_PREFIX],
    ),
    pool.query<{ id: string; definition: Record<string, unknown> }>(
      `SELECT id, definition FROM ${t("domain_components")}
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

  return {
    panels: toOptions(panelRows.rows),
    projections: toOptions(projectionRows.rows),
    components: toOptions(componentRows.rows),
    agents: agents.map(agent => ({
      id: agent.id,
      label: agent.name?.trim() || agent.id,
      ...(agent.description?.trim() ? { description: agent.description.trim() } : {}),
    })),
  };
}
