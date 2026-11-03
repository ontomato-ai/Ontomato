import type { SystemModelConfig } from "@ontomato/contracts/system-model";

/*
 * Types of the workbench's own configuration page: the query settings kept in the Node system model file. The ontology
 * service part of the system configuration and the model configuration live in the Ontology Manager
 * (@ontomato/platform-admin).
 */

export type QuerySettings = Pick<SystemModelConfig, "queryTimeoutSeconds">;
