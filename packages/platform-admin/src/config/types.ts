import type {
  DataAdapterConnection,
  MultiDataSourceDefinition,
} from "@ontomato/contracts/data-adapters";

/**
 * Types of the remaining native general settings page: general parameters and backend language.
 */

/** General parameters and language edited on the native general settings page. */
export interface SystemSettings {
  knowledgeMaxResult: number;
  dslCookerTimeout: number;
  lang: string;
  dataAdapter: string;
  dataAdapterConnections: Record<string, DataAdapterConnection>;
}

/** The parts of GET /businessConfig/getConfig the native general settings page reads. */
export interface BusinessConfig extends SystemSettings {
  multiDataSource: MultiDataSourceDefinition | null;
}

export { generalConfigSaveEndpoints, type GeneralConfigKey } from "@ontomato/contracts/general-settings";
