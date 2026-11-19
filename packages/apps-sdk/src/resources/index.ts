import { FUNCTION, METRIC_VIEW, RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import { METRIC_CHART_COMPONENT } from "@ontomato/contracts/product-panels";
import {
  AGENT_DEFINITION, ATTRIBUTE, MCP_SERVICE_OPTION, MODEL_OPTION, OBJECT_TYPE, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE,
  RELATIONSHIP, SCHEDULED_TASK, SKILL, USER,
} from "@ontomato/contracts/platform-object-types";
import type { PlatformResources } from "../panel/platform-objects";

/*
 * The resource modules of this SDK version (design 2.3), by the type or operation a projection binds: one module per
 * owner, each written against `PlatformObjectAdapter` and sending only the requests `contracts/panel-client-requests.ts`
 * declares for its binding. A module is fetched the first time a projection of the panel binds one of its types; a
 * type not listed here is one no projection of this version can bind.
 */
const ontologyMetadata = () => import("../panel/ontology-metadata").then((module) => module.ontologyMetadataAdapters);
const platformOntology = () => import("../panel/platform-ontology").then((module) => module.platformOntologyAdapters);

export const platformResources: PlatformResources = {
  objects: {
    [AGENT_DEFINITION]: () => import("../panel/agent-definition").then((module) => module.agentDefinitionAdapters),
    [SKILL]: () => import("../panel/skill").then((module) => module.skillAdapters),
    [MODEL_OPTION]: () => import("../panel/model-option").then((module) => module.modelOptionAdapters),
    [MCP_SERVICE_OPTION]: () => import("../panel/mcp-service-option").then((module) => module.mcpServiceOptionAdapters),
    [USER]: () => import("../panel/user").then((module) => module.userAdapters),
    // Classes, attributes and relationships come from one metadata read, so one module answers all three.
    [OBJECT_TYPE]: ontologyMetadata,
    [ATTRIBUTE]: ontologyMetadata,
    [RELATIONSHIP]: ontologyMetadata,
    [ONTOLOGY_TYPE]: platformOntology,
    [ONTOLOGY_RELATION_KIND]: platformOntology,
    [SCHEDULED_TASK]: () => import("../panel/schedules").then((module) => module.scheduledTaskAdapters),
    [METRIC_VIEW]: () => import("../panel/metric-view").then((module) => module.metricViewAdapters),
    [FUNCTION]: () => import("../panel/function").then((module) => module.functionAdapters),
  },
  operations: {
    [RUN_NOW]: () => import("../panel/schedules").then((module) => module.scheduledTaskRunNow),
  },
  components: {
    // A chart's source template and its MetricView's data, fetched only by a panel that draws a chart.
    [METRIC_CHART_COMPONENT]: () => import("../panel/metric-chart").then((module) => module.metricChartClients),
  },
};
