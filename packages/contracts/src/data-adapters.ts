import { z } from "zod";
import { runtimeJsonObjectSchema } from "./agent-runtime-values";

/**
 * A connection field name. The vocabulary belongs to each adapter provider:
 * the server returns the fields that provider declared, and the settings form
 * renders exactly those. A new adapter can add account/warehouse/role/... with
 * no frontend change.
 */
export type DataAdapterField = string;

/** Values of the connection fields an adapter type declares, keyed by field name. */
export type DataAdapterConnection = Partial<Record<DataAdapterField, string>>;

/** Presentation metadata one adapter provider declares for a connection field. */
export interface DataAdapterFieldInfo {
  name: string;
  label?: string | null;
  required?: boolean;
  secret?: boolean;
  example?: string | null;
  fullWidth?: boolean;
}

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
  /** Field presentation metadata; when absent the form derives it from fields/examples. */
  fieldInfos?: DataAdapterFieldInfo[];
}

/** `data` of GET /businessConfig/dataAdapters: the current domain's adapter type and the installed adapters, without saved connections. */
export interface DataAdaptersData {
  currentType: string;
  adapters: DataAdapterInfo[];
}

export const sandboxCapabilityStatusSchema = z.enum(["passed", "failed", "unsupported", "unchecked"]);
export const sandboxCapabilitySchema = z.object({
  status: sandboxCapabilityStatusSchema,
  supported: z.boolean(),
  canCreateAndDrop: z.boolean(),
  reason: z.string(),
  probeNote: z.string(),
  details: runtimeJsonObjectSchema,
}).strict();

export type SandboxCapabilityStatus = z.infer<typeof sandboxCapabilityStatusSchema>;
export type SandboxCapability = z.infer<typeof sandboxCapabilitySchema>;

const tableSchema = z.object({ name: z.string(), type: z.enum(["TABLE", "VIEW"]) });

/**
 * `data` of a successful POST /businessConfig/testDataAdapter, told apart by `kind`: a JDBC-style catalog report
 * (driver, catalog/schema and tables and views), or a search engine report (cluster and the indices visible to the
 * tested credentials). Parsed where the response is consumed, so a malformed report is a failure, not an empty catalog.
 */
export const dataAdapterTestResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("catalog"),
    sandboxCapability: sandboxCapabilitySchema.optional(),
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
    sandboxCapability: sandboxCapabilitySchema.optional(),
    elapsedMs: z.number(),
    databaseProduct: z.string(),
    databaseVersion: z.string().nullable(),
    clusterName: z.string().nullable(),
    indices: z.array(z.string()),
  }),
]);

export type DataAdapterTestResult = z.infer<typeof dataAdapterTestResultSchema>;
