import { z } from "zod";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { productPanelSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import { resolveLocale } from "../../i18n";
import { getPostgresPool } from "../../infrastructure/postgres";
import { assistantName } from "../assistant/labels";
import { assistantStore } from "../assistant/store";
import { readDefinition } from "../business-definitions/definitions";
import { productGraphAuthorizationFactsSchema } from "../governance/policy-access";
import { presentAuthorizationEdges } from "../product-assets/ontology";
import type { ProductOwner } from "../product-governance/service-authentication";
import { buildProductAssetGraph, resolveObjectTypeLabel, type AssetGraphSources } from "./asset-graph";
import { definitionVisibleInRange } from "./access";
import { objectVisibilityRangeSchema } from "../product-governance/authorization";
import { javaPanelReadResultSchema, type JavaPanelRead, type JavaPanelReadResult } from "./java-panel-reads";
import type { PanelReadSelection } from "./panel-owner-reads";
import type { RegisteredDataReadRegistration } from "./registered-data-read";
import { readCurrentDefinitionRows } from "./current";
import { currentProductRecord, type CurrentProductRow } from "../../infrastructure/product-current";
import { listObjectDetailPanelMappings } from "./object-detail";

/** The records the catalogues can show: an unreadable definition is left to its own page, as the catalogues do. */
function readableDefinitions<T>(rows: readonly CurrentProductRow[], schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }) {
  return rows.flatMap(row => {
    const parsed = schema.safeParse(currentProductRecord(row, false));
    return parsed.success && parsed.data ? [parsed.data] : [];
  });
}

async function resolveDefinitionGraphName(owner: ProductOwner, id: string, locale: string) {
  const definition = await readDefinition(owner, id);
  return resolveObjectTypeLabel(definition.objectType, locale) ?? definition.name;
}

async function resolveGraphNames(
  owner: ProductOwner, graph: ProductGraph, locale: string,
  javaName: (node: ProductGraph["nodes"][number]) => string | undefined | Promise<string | undefined>,
) {
  await Promise.all(graph.nodes.map(async node => {
    try {
      const name = node.kind === "definition" ? await resolveDefinitionGraphName(owner, node.name, locale) : await javaName(node);
      if (name) node.name = name;
    } catch {
      // Keep the source ID when display metadata is unavailable.
    }
  }));
}

const applicationReferencesSchema = z.array(z.object({
  id: z.string(), names: z.record(z.string()), canMaintain: z.boolean(),
  framePanelId: z.string().optional(), panelIds: z.array(z.string()), defaultAgentIds: z.array(z.string()),
}));
type ApplicationReferences = z.infer<typeof applicationReferencesSchema>;

async function readLocalGraphSources(domainId: string) {
  const [agents, objectDetailMappings] = await Promise.all([
    assistantStore.agents(domainId),
    listObjectDetailPanelMappings(domainId, getPostgresPool()),
  ]);
  return { agents, objectDetailMappings };
}

function assembleProductAssetGraph(
  panels: AssetGraphSources["panels"], projections: AssetGraphSources["projections"],
  applications: ApplicationReferences, { agents, objectDetailMappings }: Awaited<ReturnType<typeof readLocalGraphSources>>,
  locale: string,
) {
  const graph = buildProductAssetGraph({
    panels,
    projections,
    applications: applications.map(app => ({
      ...app, name: localizedApplicationText(app.names, locale) ?? app.id,
    })),
    agents: agents.filter(agent => agent.enabled).map(agent => ({ id: agent.id, name: assistantName(agent, locale) })),
    objectDetailMappings,
    objectTypeLabel: className => resolveObjectTypeLabel(className, locale) ?? className,
  });
  return { graph, maintainableApplicationIds: new Set(applications.filter(app => app.canMaintain).map(app => app.id)) };
}

function candidateDefinitions(panelRows: readonly CurrentProductRow[], projectionRows: readonly CurrentProductRow[]) {
  return {
    panels: readableDefinitions(panelRows, productPanelSchema),
    projections: readableDefinitions(projectionRows, productProjectionSchema).map(projection => ({
      ...projection, shared: projection.visibility === "domain",
    })),
  };
}

const graphFactsSchema = z.object({
  panels: javaPanelReadResultSchema,
  projections: javaPanelReadResultSchema,
  applications: javaPanelReadResultSchema,
  authorization: javaPanelReadResultSchema,
  objectTypes: z.record(javaPanelReadResultSchema),
  actions: z.record(javaPanelReadResultSchema),
  metrics: z.record(javaPanelReadResultSchema),
});

function graphReferences(panels: AssetGraphSources["panels"], projections: AssetGraphSources["projections"],
  mappings: AssetGraphSources["objectDetailMappings"], locale: string,
) {
  // Before authorization removes candidates, select labels only from the possible business graph.
  // Removing candidates can detach a standalone projection, but cannot add an ontology reference.
  const candidates = buildProductAssetGraph({
    panels, projections, objectDetailMappings: mappings,
    applications: [], agents: [], objectTypeLabel: id => id,
  });
  const objectTypes: string[] = [];
  const actions: string[] = [];
  const metrics: string[] = [];
  for (const node of candidates.nodes) {
    if (node.kind === "object-type" && resolveObjectTypeLabel(node.name, locale) === undefined) objectTypes.push(node.name);
    if (node.kind === "action") actions.push(node.name);
    if (node.kind === "metric") metrics.push(node.name);
  }
  return {
    panelIds: panels.map(panel => panel.id),
    projectionIds: projections.map(projection => projection.id),
    objectTypes,
    actions,
    metrics,
  };
}

function fact<T>(result: JavaPanelReadResult | undefined, schema: z.ZodType<T>): T | undefined {
  return result?.status === "ready" ? schema.parse(result.payload) : undefined;
}

function presentProductAssetGraph(graph: ProductGraph): PanelRecord {
  return { className: OBJECT_TYPE, primaryKey: "product-graph", label: "Product graph",
    fields: { graph: { kind: "json", value: graph } } };
}

export function isProductAssetGraphRead(selection: PanelReadSelection) {
  return selection.typeId === OBJECT_TYPE && selection.method === "productGraph";
}

export async function prepareProductAssetGraphRead(owner: ProductOwner, locale?: string) {
  const language = resolveLocale(locale);
  const { domainId } = owner;
  const [panelRows, projectionRows, local] = await Promise.all([
    readCurrentDefinitionRows(domainId, "panel"),
    readCurrentDefinitionRows(domainId, "projection"),
    readLocalGraphSources(domainId),
  ]);
  const { panels, projections } = candidateDefinitions(panelRows, projectionRows);
  const call: NonNullable<JavaPanelRead["call"]> = {
    type: OBJECT_TYPE, name: "productGraph", parameters: graphReferences(panels, projections, local.objectDetailMappings, language),
  };
  return {
    call,
    async present(payload: unknown) {
      const facts = graphFactsSchema.parse(payload);
      const panelUse = fact(facts.panels, objectVisibilityRangeSchema);
      const projectionUse = fact(facts.projections, objectVisibilityRangeSchema);
      const readablePanels = panelUse && new Set(panelRows.filter(row => definitionVisibleInRange(row, panelUse, domainId)).map(({ id }) => id));
      const readableProjections = projectionUse && new Set(projectionRows.filter(row => definitionVisibleInRange(row, projectionUse, domainId)).map(({ id }) => id));
      const result = assembleProductAssetGraph(
        panels.filter(panel => readablePanels?.has(panel.id)),
        projections.filter(projection => readableProjections?.has(projection.id)),
        fact(facts.applications, applicationReferencesSchema) ?? [], local, language,
      );
      await resolveGraphNames(owner, result.graph, language, node => {
        switch (node.kind) {
          case "object-type": return fact(facts.objectTypes[node.id.slice("object-type:".length)], z.string());
          case "action": return fact(facts.actions[node.name], z.string());
          case "metric": return fact(facts.metrics[node.name], z.string());
        }
      });
      return presentProductAssetGraph(presentAuthorizationEdges(result, fact(facts.authorization, productGraphAuthorizationFactsSchema), locale));
    },
  };
}

export const assetGraphDataReadRegistrations: RegisteredDataReadRegistration[] = [
  {
    typeId: OBJECT_TYPE, method: "productGraph",
    prepare: ({ owner, credentials }) => prepareProductAssetGraphRead(owner, credentials.locale),
  },
];
