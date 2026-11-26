import { FUNCTION, METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import {
  ACTION, AGENT_DEFINITION, DASHBOARD_CARD, ATTRIBUTE, EXTERNAL_MCP_SERVICE, MODEL_OPTION, OBJECT_TYPE, ONTOLOGY_RELATION_KIND,
  ONTOLOGY_TYPE, RELATIONSHIP, USER,
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
    [MODEL_OPTION]: () => import("../panel/model-option").then((module) => module.modelOptionAdapters),
    [EXTERNAL_MCP_SERVICE]: () => import("../panel/external-mcp-service").then((module) => module.externalMcpServiceAdapters),
    [USER]: () => import("../panel/user").then((module) => module.userAdapters),
    // Classes, attributes and relationships come from one metadata read, so one module answers all three.
    [OBJECT_TYPE]: ontologyMetadata,
    [ATTRIBUTE]: ontologyMetadata,
    [RELATIONSHIP]: ontologyMetadata,
    [ONTOLOGY_TYPE]: platformOntology,
    [ONTOLOGY_RELATION_KIND]: platformOntology,
    [METRIC_VIEW]: () => import("../panel/metric-view").then((module) => module.metricViewAdapters),
    [FUNCTION]: () => import("../panel/function").then((module) => module.functionAdapters),
    [ACTION]: () => import("../panel/action").then((module) => module.actionAdapters),
    // A chart's source card: its drawing and its MetricView's output, fetched only by a panel that draws a chart.
    [DASHBOARD_CARD]: () => import("../panel/metric-chart").then((module) => module.dashboardCardAdapters),
  },
  // A person's action runs through the platform's coordinator, as an agent's does; none runs in the frame.
  operations: {},
};
