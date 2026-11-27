import { actionDataReadRegistrations } from "../action/panel-reads";
import { auditLogDataReadRegistrations } from "../admin/audit-log-panel-reads";
import { dataAdapterDataReadRegistrations } from "../admin/data-adapters-panel";
import { feedbackDataReadRegistrations } from "../admin/feedback-panel-reads";
import { generalSettingsDataReadRegistrations } from "../admin/general-settings-panel";
import { modelSettingsDataReadRegistrations } from "../admin/model-settings-panel";
import { applicationBuilderPanelDataReadRegistrations } from "../app-builder/application-panel-reads";
import { applicationBuilderSourceDataReadRegistrations } from "../app-builder/registered-source-reads";
import { assistantDataReadRegistrations } from "../assistant/panel-reads";
import { businessKnowledgeDataReadRegistrations } from "../business-knowledge/panel-reads";
import { dashboardMetricDataReadRegistrations } from "../dashboard/panel-chart-read-plan";
import { dashboardLocalDataReadRegistrations } from "../dashboard/panel-reads";
import { governanceDataReadRegistrations } from "../governance/registered-data-reads";
import { externalMcpDataReadRegistrations } from "../mcp/external-mcp-panel";
import { publishedMcpDataReadRegistrations } from "../mcp/panel-reads";
import { metricFunctionDataReadRegistrations } from "../metric-function/panel-reads";
import { ontologyModelDataReadRegistrations } from "../ontology-model/model-reads";
import { autotestCaseSetDataReadRegistrations } from "../ops-diagnosis/case-sets-panel";
import { opsDiagnosisDataReadRegistrations } from "../ops-diagnosis/panel-reads";
import { ontologyDataReadRegistrations } from "../platform-ontology/registered-reads";
import { triggerDataReadRegistrations } from "../scheduling/registered-trigger-reads";
import { skillDataReadRegistrations } from "../skills/registered-library-reads";
import { workflowDataReadRegistrations } from "../workflow/panel-reads";
import { agentDefinitionDataReadRegistrations } from "./agent-definition-directory";
import { agentSessionDataReadRegistrations } from "./agent-session-panel";
import { applicationCatalogueDataReadRegistrations } from "./application-catalogue";
import { assetGraphDataReadRegistrations } from "./asset-graph-read";
import { productCatalogueDataReadRegistrations } from "./catalog-reads";
import { sdkComponentDataReadRegistrations } from "./sdk-component-data-reads";
import { customerDataReadRegistrations } from "./customer-data-read-plan";
import { favoriteDataReadRegistrations } from "./favorite-panel";
import { objectDetailDataReadRegistrations } from "./object-detail-reads";
import { recentVisitDataReadRegistrations } from "./recent-visit-panel";
import type { RegisteredDataReadRegistration } from "./registered-data-read";

/** Each feature module contributes its own entries; this file only lists them. */
export const registeredDataReads: readonly RegisteredDataReadRegistration[] = [
  ...customerDataReadRegistrations,
  ...assistantDataReadRegistrations,
  ...applicationCatalogueDataReadRegistrations,
  ...agentDefinitionDataReadRegistrations,
  ...productCatalogueDataReadRegistrations,
  ...assetGraphDataReadRegistrations,
  ...favoriteDataReadRegistrations,
  ...recentVisitDataReadRegistrations,
  ...applicationBuilderPanelDataReadRegistrations,
  ...applicationBuilderSourceDataReadRegistrations,
  ...dashboardMetricDataReadRegistrations,
  ...dashboardLocalDataReadRegistrations,
  ...publishedMcpDataReadRegistrations,
  ...externalMcpDataReadRegistrations,
  ...modelSettingsDataReadRegistrations,
  ...workflowDataReadRegistrations,
  ...skillDataReadRegistrations,
  ...ontologyDataReadRegistrations,
  ...triggerDataReadRegistrations,
  ...actionDataReadRegistrations,
  ...auditLogDataReadRegistrations,
  ...businessKnowledgeDataReadRegistrations,
  ...dataAdapterDataReadRegistrations,
  ...generalSettingsDataReadRegistrations,
  ...metricFunctionDataReadRegistrations,
  ...ontologyModelDataReadRegistrations,
  ...objectDetailDataReadRegistrations,
  ...governanceDataReadRegistrations,
  ...feedbackDataReadRegistrations,
  ...opsDiagnosisDataReadRegistrations,
  ...autotestCaseSetDataReadRegistrations,
  ...sdkComponentDataReadRegistrations,
  ...agentSessionDataReadRegistrations,
];
