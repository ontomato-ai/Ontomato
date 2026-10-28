import { z } from "zod";
import type { SystemModelConfig } from "@ontomato/contracts/system-model";
import type {
  BackendAgentConfig,
  BackendModelConfig,
  ModelRole,
} from "@ontomato/contracts/model-settings";
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
 * A model entry edited on the model configuration page: based on the entry read by getModelSettings, with fields that
 * have no controls (organizationId etc.) round-tripped as-is in the snapshot. Unset optional fields may be null when
 * read; new or cleared maxTokens / contextWindow are submitted as null and Java's read normalization fills the defaults.
 */
export type ModelEntry = Omit<
  BackendModelConfig,
  "maxTokens" | "contextWindow" | "timeout" | "maxRetries" | "temperature" | "topP"
> & {
  maxTokens: number | null;
  contextWindow: number | null;
  timeout?: string | null;
  maxRetries?: number | null;
  temperature?: number | null;
  topP?: number | null;
  maxCompletionTokens?: number | null;
};

/** A save the page hands to a card's dialog: resolves to whether the value was saved; the dialog closes only on success. */
export type SaveAction<T> = (value: T) => Promise<boolean>;

/** Draft model references of the five roles: a config ID or not configured (null); same shape as agents in the saveModelSettings request. */
export type RoleModels = Record<ModelRole, string | null>;

export interface EmbeddingModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: string;
  /** Vector dimensions of this domain: sent with every embedding request, a positive integer. */
  dimensions: number;
  customHeaders?: Record<string, string> | null;
}

// Java omits null fields from the response; the boundary normalizes an absent value to null.
const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value) => value ?? null);
const vectorRebuildProgress = { total: z.number().int().nonnegative(), done: z.number().int().nonnegative() };

/** Where and why the latest round failed; CLEAR covers the whole domain, CLEAR and READ have no item id. */
const vectorRebuildFailureSchema = z.object({
  phase: z.enum(["CLEAR", "READ", "EMBED", "SAVE"]),
  itemType: nullable(z.enum(["KNOWLEDGE", "EXAMPLE", "SPLIT_EXAMPLE", "ACTION", "METRIC_VIEW", "RESOURCE"])),
  itemId: nullable(z.string()),
  reason: z.string(),
});

/**
 * GET /businessConfig/vectorRebuildStatus, validated where the page reads it: a failure is reported exactly when
 * the state is FAILED. Vector search is open only when READY; PAUSING means the run stops after its current item,
 * INTERRUPTED that the service stopped during a round.
 */
export const vectorRebuildStatusSchema = z.union([
  z.object({ ...vectorRebuildProgress, state: z.literal("FAILED"), error: vectorRebuildFailureSchema }),
  z.object({
    ...vectorRebuildProgress,
    state: z.enum(["READY", "PENDING", "RUNNING", "PAUSING", "PAUSED", "INTERRUPTED"]),
    error: z.null().optional().transform(() => null),
  }),
]);

export type VectorRebuildStatus = z.output<typeof vectorRebuildStatusSchema>;
export type VectorRebuildState = VectorRebuildStatus["state"];

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
  { ok: true; result: DataAdapterTestResult } | { ok: false; message: string };

/** Tests a candidate connection without saving it; resolves to the outcome, never rejects. */
export type TestConnection = (request: DataAdapterRequest) => Promise<DataAdapterTestOutcome>;

/** Why the last multi-source save failed: the located problems the data engine found, or only a message. */
export interface MultiDataSourceSaveFailure {
  message: string;
  problems: ConfigurationProblem[];
}

/** General parameters, language and data adapter edited on the system config page. */
export interface SystemSettings {
  knowledgeMaxResult: number;
  toolAndPythonRetry: number;
  dslCookerTries: number;
  dslCookerTimeout: number;
  questionSpliterTries: number;
  questionSpliterTimeout: number;
  lang: string;
  dataAdapter: string;
  dataAdapterConnections: Record<string, DataAdapterConnection>;
}

/** The parts of GET /businessConfig/getConfig the two pages read: the system config page reads general settings and the skill directory, the model configuration page reads Embedding. */
export interface BusinessConfig extends SystemSettings {
  agents: Record<ModelRole, BackendAgentConfig>;
  embeddingModelProperties: EmbeddingModelConfig | null;
  /** The saved multi-source definition; null until one is saved. */
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

export type GeneralConfigKey =
  | "knowledgeMaxResult"
  | "toolAndPythonRetry"
  | "dslCookerTries"
  | "dslCookerTimeout"
  | "questionSpliterTries"
  | "questionSpliterTimeout"
  | "lang";

// Model identity: name is the fixed config ID and displayName may be duplicated;
// append the ID when they differ, show it once when they match.
export function modelLabel(model: { name: string; displayName: string }): string {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

export function formatTimeout(seconds: number): string {
  return `PT${seconds}S`;
}

/** The query settings the system configuration page edits. */
export type QuerySettings = Pick<SystemModelConfig, "queryTimeoutSeconds">;
