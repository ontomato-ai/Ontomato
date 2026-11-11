import { z } from "zod";

/** Fields a data adapter connection can have; which ones each adapter needs comes from its fields. */
export type DataAdapterField = "url" | "company" | "user" | "password";

/** Values of the connection fields an adapter type declares; the single-source connections and each data source of a multi-source definition hold one. */
export type DataAdapterConnection = Partial<Record<DataAdapterField, string>>;

/** Body of POST /businessConfig/useDataAdapter and /businessConfig/testDataAdapter: an adapter type and its connection field values. */
export type DataAdapterRequest = { type: string } & DataAdapterConnection;

/** Catalog type of the multi-source adapter: it has no connection of its own and is saved through POST /businessConfig/useMultiDataSource. */
export const multiDataSourceType = "multi";

/** A data source of a multi-source definition: one installed adapter type with its own connection. */
export interface DataSourceEntry {
  id: string;
  label: string;
  adapterType: string;
  readOnly: boolean;
  connection: DataAdapterConnection;
}

/** Routes an ontology class (forOntoMap is its className) to a data source. */
export interface ClassRoute {
  forOntoMap: string;
  sourceId: string;
}

/** The physical edge name of an ontology relationship (forOntoMap is its name); its data source follows from its end classes' routes. */
export interface RelationshipRoute {
  forOntoMap: string;
  realEdge: string;
}

/** Body of POST /businessConfig/useMultiDataSource, and `multiDataSource` of GET /businessConfig/getConfig once saved. */
export interface MultiDataSourceDefinition {
  dataSources: DataSourceEntry[];
  classes: ClassRoute[];
  relationships: RelationshipRoute[];
}

/** One located problem: `path` names the offending entry (e.g. `dataSources[crm]`), `detail` says what is wrong. */
const configurationProblemSchema = z.object({ path: z.string(), detail: z.string() });

export type ConfigurationProblem = z.infer<typeof configurationProblemSchema>;

/**
 * A rejected POST /businessConfig/useMultiDataSource (`success: false`): `data` lists every located problem of the
 * definition and of the ontology under it. A failure without it (e.g. an unexpected error) has only its message.
 */
export const multiDataSourceRejectionSchema = z.object({
  data: z.object({ problems: z.array(configurationProblemSchema) }),
});

/** A data adapter installed in this edition. */
export interface DataAdapterInfo {
  type: string;
  label: string;
  /** Whether relations name the source and target join fields (fromField/toField) the adapter joins on; false for native graph relations. */
  requiresJoinFields: boolean;
  fields: DataAdapterField[];
  /** Input examples (only for fields that have one), declared by the adapter module. */
  examples: Partial<Record<DataAdapterField, string>>;
}

/** `data` of GET /businessConfig/dataAdapters: the current domain's adapter type and the installed adapters, without saved connections. */
export interface DataAdaptersData {
  currentType: string;
  adapters: DataAdapterInfo[];
}

/** A catalog entry: a relational table, a view, or a document/graph collection (e.g. ArangoDB). */
const tableSchema = z.object({ name: z.string(), type: z.enum(["TABLE", "VIEW", "COLLECTION"]) });

/**
 * `data` of a successful POST /businessConfig/testDataAdapter, told apart by `kind`: a JDBC-style catalog report
 * (driver, catalog/schema and tables and views), or a search engine report (cluster and the indices visible to the
 * tested credentials). Parsed where the response is consumed, so a malformed report is a failure, not an empty catalog.
 */
export const dataAdapterTestResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("catalog"),
    elapsedMs: z.number(),
    databaseProduct: z.string(),
    databaseVersion: z.string(),
    driverName: z.string(),
    driverVersion: z.string(),
    catalog: z.string().nullable(),
    schema: z.string().nullable(),
    tables: z.array(tableSchema),
  }),
  z.object({
    kind: z.literal("search"),
    elapsedMs: z.number(),
    databaseProduct: z.string(),
    databaseVersion: z.string().nullable(),
    clusterName: z.string().nullable(),
    indices: z.array(z.string()),
  }),
]);

export type DataAdapterTestResult = z.infer<typeof dataAdapterTestResultSchema>;
