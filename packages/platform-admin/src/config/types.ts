import { z } from "zod";
import type {
  ConfigurationProblem,
  DataAdapterConnection,
  DataAdapterInfo,
  DataAdapterRequest,
  DataAdapterTestResult,
  DataSourceEntry,
  MultiDataSourceDefinition,
} from "@ontomato/contracts/data-adapters";

/**
 * Types and pure helpers of the platform pages: the general parameters, language and data adapter edited on the system
 * configuration page. The model configuration page has its own types in `models/types.ts`.
 */

/** Save and test send the same request: the adapter type plus the current values of only the connection fields it declares. */
export function dataAdapterRequest(
  adapter: DataAdapterInfo,
  connection: DataAdapterConnection
): DataAdapterRequest {
  return {
    type: adapter.type,
    ...Object.fromEntries(adapter.fields.map((field) => [field, connection[field]])),
  };
}

/** Outcome of the last connection test of the data adapter form: the adapter's report, or the failure message. */
export type DataAdapterTestOutcome =
  | { ok: true; result: DataAdapterTestResult }
  | { ok: false; message: string };

/** Tests a candidate connection without saving it; resolves to the outcome, never rejects. */
export type TestConnection = (request: DataAdapterRequest) => Promise<DataAdapterTestOutcome>;

/** Why the last multi-source save failed: the located problems the data engine found, or only a message. */
export interface MultiDataSourceSaveFailure {
  message: string;
  problems: ConfigurationProblem[];
}

/** General parameters, language and data adapter edited on the system configuration page. */
export interface SystemSettings {
  knowledgeMaxResult: number;
  dslCookerTimeout: number;
  lang: string;
  dataAdapter: string;
  dataAdapterConnections: Record<string, DataAdapterConnection>;
}

/** The parts of GET /businessConfig/getConfig the system configuration page reads. */
export interface BusinessConfig extends SystemSettings {
  multiDataSource: MultiDataSourceDefinition | null;
}

/**
 * The parts of GET /admin/getSchema the multi-source editor lists: every ontology class, and every relationship with
 * its end classes. Validated where it is read.
 */
export const ontologyOutlineSchema = z
  .object({
    classDefs: z.array(z.object({ name: z.string() })),
    relationshipDefs: z.record(z.string(), z.object({ fromClass: z.string(), toClass: z.string() })),
  })
  .transform(({ classDefs, relationshipDefs }) => ({
    classNames: classDefs.map(({ name }) => name),
    relationships: Object.entries(relationshipDefs).map(([name, { fromClass, toClass }]) => ({
      name,
      fromClass,
      toClass,
    })),
  }));

export type OntologyOutline = z.output<typeof ontologyOutlineSchema>;

/**
 * Draft of the multi-source editor: the data sources, the chosen source id per class name and the physical edge name
 * per relationship name. It keeps entries of classes and relationships the ontology no longer has; only the
 * definition built for saving is limited to the current ontology.
 */
export interface MultiDataSourceDraft {
  dataSources: DataSourceEntry[];
  classSources: Record<string, string | undefined>;
  realEdges: Record<string, string | undefined>;
}

/** The draft of a saved definition; with none saved (null), a draft without sources, routes or edge names. */
export function multiDataSourceDraft(saved: MultiDataSourceDefinition | null): MultiDataSourceDraft {
  const definition = saved ?? { dataSources: [], classes: [], relationships: [] };
  return {
    dataSources: definition.dataSources,
    classSources: Object.fromEntries(definition.classes.map((route) => [route.forOntoMap, route.sourceId])),
    realEdges: Object.fromEntries(
      definition.relationships.map((route) => [route.forOntoMap, route.realEdge])
    ),
  };
}

/** The definition saved from a draft: routes of the current ontology's classes, and the edge names given for its relationships (blank means the relationship name). */
export function multiDataSourceDefinition(
  draft: MultiDataSourceDraft,
  ontology: OntologyOutline
): MultiDataSourceDefinition {
  const classes = ontology.classNames.flatMap((name) => {
    const sourceId = draft.classSources[name];
    return sourceId ? [{ forOntoMap: name, sourceId }] : [];
  });
  const relationships = ontology.relationships.flatMap(({ name }) => {
    const realEdge = draft.realEdges[name]?.trim();
    return realEdge ? [{ forOntoMap: name, realEdge }] : [];
  });
  return { dataSources: draft.dataSources, classes, relationships };
}

export type GeneralConfigKey = "knowledgeMaxResult" | "dslCookerTimeout" | "lang";

/** Endpoints of the general settings saves, one per editable key. */
export const generalConfigSaveEndpoints: Record<GeneralConfigKey, string> = {
  knowledgeMaxResult: "/businessConfig/saveKnowledgeMaxResult",
  dslCookerTimeout: "/businessConfig/saveDslCookerTimeout",
  lang: "/businessConfig/saveLang",
};
