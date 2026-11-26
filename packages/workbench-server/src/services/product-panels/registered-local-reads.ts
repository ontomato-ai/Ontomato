import {
  AGENT_DEFINITION, AGENT_SESSION, APPLICATION, AUTOTEST_CASE_ARTIFACT, AUTOTEST_CASE_SET, AUTOTEST_RUN, DASHBOARD, DASHBOARD_CARD,
  DSL_QUERY, EXTERNAL_MCP_SERVICE, FAVORITE, FEEDBACK_RECORD, OBJECT_TYPE, OPS_KNOWLEDGE, PRODUCT_PANEL, PRODUCT_PROJECTION, SDK_COMPONENT, TURN_EVIDENCE,
} from "@ontomato/contracts/platform-object-types";
import { panelReadParameterSchemas, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import { z } from "zod";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { createRegisteredFeedbackReadAdapter } from "../admin/feedback-panel-reads";
import { createDashboardCardOwnerReadAdapter, createDashboardReadAdapter } from "../dashboard/panel-reads";
import {
  createExternalMcpReads, createRegisteredExternalMcpDirectoryReads, createRegisteredExternalMcpFormReads, readRegisteredExternalMcpTools,
} from "../mcp/external-mcp-panel";
import { createRegisteredAutotestCaseSetReadAdapter } from "../ops-diagnosis/case-sets-panel";
import {
  createRegisteredAutotestCaseArtifactReadAdapter, createRegisteredAutotestRunReadAdapter,
  createRegisteredDslQueryReadAdapter, createRegisteredOpsKnowledgeReadAdapter, createRegisteredTurnEvidenceReadAdapter,
} from "../ops-diagnosis/panel-reads";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { DefinitionVisibilityRange } from "./access";
import { createAgentSessionReadAdapter } from "./agent-session-panel";
import {
  presentRegisteredApplicationEntryRows, presentRegisteredApplicationRecord,
  presentRegisteredApplicationReferenceGraph, presentRegisteredApplicationUsedPanels,
} from "./application-catalogue";
import { createScopedProductPanelReads, createScopedProductProjectionReads, readRegisteredHomePanel, readScopedPanelPickerOptions } from "./catalog-reads";
import {
  countSdkComponentsInRange, listSdkComponents, readSdkComponent, readSdkComponentConfigRows, readSdkComponentDataRows,
  readSdkComponentInputRows, readSdkComponentOperationRows, readSdkComponentOutputRows, readSdkComponentRecord,
} from "./component-catalogue";
import { createFavoriteReadAdapter } from "./favorite-panel";
import type { PanelReadRanges, PanelReadVisibility } from "./java-panel-reads";
import { createRegisteredObjectDetailReadAdapter } from "./object-detail-reads";

interface RegisteredLocalRead {
  visibility?: readonly PanelReadVisibility[];
  /** A mixed owner also needs its Java facts in the same batch item. */
  readJavaFacts?: true;
  read(owner: ProductOwner, ranges: PanelReadRanges | undefined, javaFacts: unknown,
    credentials: AssistantCredentials, primaryKey: string | undefined, params: Record<string, unknown>): Promise<unknown>;
}

function managedOpsRead<Adapter>(
  adapter: (owner: ProductOwner, locale: string | undefined, facts: unknown) => Adapter,
  read: (adapter: Adapter, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalRead {
  return {
    readJavaFacts: true,
    read: (owner, _ranges, facts, credentials, primaryKey, params) =>
      read(adapter(owner, credentials.locale, facts), primaryKey!, params),
  };
}

function sdkComponentUseRead(
  read: (owner: ProductOwner, primaryKey: string, credentials: AssistantCredentials, range: DefinitionVisibilityRange,
    params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalRead {
  return {
    visibility: [{ kind: "COMPONENT", verbs: ["USE"] }],
    read(owner, ranges, _facts, credentials, primaryKey, params) {
      const range = ranges?.COMPONENT?.USE;
      if (!range) throw new HttpError(502, "The panel read owner did not provide COMPONENT/USE visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
      return read(owner, primaryKey!, credentials, range, params);
    },
  };
}

function objectDetailRead(
  read: (adapter: ReturnType<typeof createRegisteredObjectDetailReadAdapter>, className: string, params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalRead {
  return {
    visibility: [{ kind: "PANEL", verbs: ["USE"] }],
    readJavaFacts: true,
    read(owner, ranges, facts, credentials, primaryKey, params) {
      const adapter = createRegisteredObjectDetailReadAdapter(owner, credentials, z.boolean().parse(facts), ranges!.PANEL.USE);
      return read(adapter, primaryKey!, params);
    },
  };
}

function externalMcpDirectoryRead(
  read: (adapter: ReturnType<typeof createRegisteredExternalMcpDirectoryReads>, key: string) => Promise<unknown>,
): RegisteredLocalRead {
  return {
    visibility: [{ kind: "AGENT", verbs: ["VIEW"] }],
    readJavaFacts: true,
    read(owner, ranges, facts, credentials, key) {
      const view = ranges?.AGENT?.VIEW;
      if (!view) throw new HttpError(502, "The panel read owner did not provide AGENT/VIEW visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
      return read(createRegisteredExternalMcpDirectoryReads(owner, credentials.locale, facts, view), key!);
    },
  };
}

const applicationPanelVisibility = [{ kind: "PANEL", verbs: ["USE", "EDIT"] }] as const;
const panelUse = [{ kind: "PANEL", verbs: ["USE"] }] as const;
const projectionUse = [{ kind: "PROJECTION", verbs: ["USE"] }] as const;
const projectionEdit = [{ kind: "PROJECTION", verbs: ["USE", "EDIT"] }] as const;
const componentUse = [{ kind: "COMPONENT", verbs: ["USE"] }] as const;

function panelCatalogueRead(
  visibility: readonly PanelReadVisibility[],
  read: (reads: ReturnType<typeof createScopedProductPanelReads>, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
  readJavaFacts?: true,
): RegisteredLocalRead {
  return {
    visibility,
    readJavaFacts,
    read(owner, ranges, facts, credentials, primaryKey, params) {
      const { USE, EDIT } = ranges!.PANEL;
      return read(createScopedProductPanelReads(owner, credentials, { USE, EDIT }, ranges!.PROJECTION?.USE, facts), primaryKey!, params);
    },
  };
}

function projectionCatalogueRead(
  visibility: readonly PanelReadVisibility[],
  read: (reads: ReturnType<typeof createScopedProductProjectionReads>, primaryKey: string, params: Record<string, unknown>) => Promise<unknown>,
): RegisteredLocalRead {
  return {
    visibility,
    read(owner, ranges, _facts, credentials, primaryKey, params) {
      const { USE, EDIT } = ranges!.PROJECTION;
      const reads = createScopedProductProjectionReads(owner, credentials, { USE, EDIT }, ranges!.COMPONENT?.USE, ranges!.PANEL?.USE);
      return read(reads, primaryKey!, params);
    },
  };
}

function catalogueFormValues(params: Record<string, unknown>) {
  requireFormFieldNames(params.values, "values");
  return { values: params.values as PanelFormValues | undefined };
}

/** Only workbench owners belong here. Java locates its own handlers from their service registrations. */
export const registeredLocalReads: Readonly<Record<string, Readonly<Record<string, RegisteredLocalRead | undefined>> | undefined>> = {
  [AGENT_DEFINITION]: {
    count: {
      visibility: [{ kind: "AGENT", verbs: ["VIEW"] }],
      readJavaFacts: true,
      async read(owner, ranges, facts, credentials) {
        const { createAgentDefinitionDirectory } = await import("./agent-definition-directory");
        return createAgentDefinitionDirectory(owner, credentials).countFromBatch(ranges!.AGENT.VIEW, facts);
      },
    },
    list: {
      visibility: [{ kind: "AGENT", verbs: ["VIEW", "EDIT"] }],
      readJavaFacts: true,
      async read(owner, ranges, facts, credentials) {
        const { createAgentDefinitionDirectory } = await import("./agent-definition-directory");
        return createAgentDefinitionDirectory(owner, credentials).listFromBatch(ranges!.AGENT, facts);
      },
    },
  },
  [OBJECT_TYPE]: {
    detailPanel: objectDetailRead((adapter, key) => adapter.record(key)),
    detailPanelForm: objectDetailRead((adapter, key, params) => {
      requireFormFieldNames(params.values, "values");
      return adapter.form(key, params.values as PanelFormValues | undefined);
    }),
  },
  [PRODUCT_PANEL]: {
    options: {
      visibility: panelUse,
      read(owner, ranges, _facts, _credentials, _key, params) {
        return readScopedPanelPickerOptions(owner, ranges!.PANEL.USE, params.keyword as string | undefined,
          params.page as Parameters<typeof readScopedPanelPickerOptions>[3]);
      },
    },
    unavailable: panelCatalogueRead(applicationPanelVisibility, reads => reads.unavailable()),
    memberRows: panelCatalogueRead([...applicationPanelVisibility, ...projectionUse], (reads, key) => reads.memberRows(key)),
    usedByRows: panelCatalogueRead(applicationPanelVisibility, (reads, key) => reads.usedByRows(key), true),
    referenceGraph: panelCatalogueRead([...applicationPanelVisibility, ...projectionUse], (reads, key) => reads.referenceGraph(key), true),
    sourceFiles: panelCatalogueRead(panelUse, (reads, key) => reads.sourceFiles(key)),
    sourceFile: panelCatalogueRead(panelUse, (reads, key, params) =>
      reads.sourceFile(key, panelReadParameterSchemas.skillFilePath.parse(params.path))),
    form: panelCatalogueRead(applicationPanelVisibility, (reads, key, params) => reads.form(key, catalogueFormValues(params))),
    homePanel: {
      visibility: [{ kind: "PANEL", verbs: ["USE"] }],
      read(owner, ranges, _facts, credentials) {
        const range = ranges?.PANEL?.USE;
        if (!range) throw new HttpError(502, "The panel read owner did not provide PANEL/USE visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
        return readRegisteredHomePanel(owner, credentials.locale, range);
      },
    },
  },
  [PRODUCT_PROJECTION]: {
    componentOptions: projectionCatalogueRead([...projectionUse, ...componentUse], reads => reads.componentOptions()),
    objectTypeOptions: projectionCatalogueRead(projectionUse, reads => reads.objectTypeOptions()),
    dataRows: projectionCatalogueRead(projectionUse, (reads, key) => reads.dataRows(key)),
    configRows: projectionCatalogueRead(projectionUse, (reads, key) => reads.configRows(key)),
    inputRows: projectionCatalogueRead(projectionUse, (reads, key) => reads.inputRows(key)),
    outputRows: projectionCatalogueRead(projectionUse, (reads, key) => reads.outputRows(key)),
    operationRows: projectionCatalogueRead(projectionUse, (reads, key) => reads.operationRows(key)),
    usedByRows: projectionCatalogueRead([...projectionUse, ...panelUse], (reads, key) => reads.usedByRows(key)),
    referenceGraph: projectionCatalogueRead([...projectionUse, ...panelUse], (reads, key) => reads.referenceGraph(key)),
    form: projectionCatalogueRead([...projectionEdit, ...componentUse], (reads, key, params) => reads.form(key, catalogueFormValues(params))),
  },
  [APPLICATION]: {
    record: {
      visibility: applicationPanelVisibility,
      readJavaFacts: true,
      read(owner, ranges, facts, credentials) {
        const { USE, EDIT } = ranges!.PANEL;
        return presentRegisteredApplicationRecord(owner.domainId, credentials.locale, facts, { USE, EDIT });
      },
    },
    entryRows: {
      visibility: applicationPanelVisibility,
      readJavaFacts: true,
      read(owner, ranges, facts, credentials) {
        const { USE, EDIT } = ranges!.PANEL;
        return presentRegisteredApplicationEntryRows(owner.domainId, credentials.locale, facts, { USE, EDIT });
      },
    },
    usedPanels: {
      visibility: applicationPanelVisibility,
      readJavaFacts: true,
      read(owner, ranges, facts, credentials) {
        const { USE, EDIT } = ranges!.PANEL;
        return presentRegisteredApplicationUsedPanels(owner.domainId, credentials.locale, facts, { USE, EDIT });
      },
    },
    referenceGraph: {
      visibility: [...applicationPanelVisibility, { kind: "PROJECTION", verbs: ["USE"] }],
      readJavaFacts: true,
      read(owner, ranges, facts, credentials) {
        const { USE, EDIT } = ranges!.PANEL;
        return presentRegisteredApplicationReferenceGraph(owner.domainId, credentials.locale, facts, { USE, EDIT }, ranges!.PROJECTION.USE);
      },
    },
  },
  [DASHBOARD]: {
    list: {
      read: (owner, _ranges, _facts, credentials) => createDashboardReadAdapter(owner, credentials).list(),
    },
    record: {
      read: (owner, _ranges, _facts, credentials, primaryKey) => createDashboardReadAdapter(owner, credentials).record(primaryKey!),
    },
    cards: {
      read: (owner, _ranges, _facts, credentials, primaryKey) => createDashboardReadAdapter(owner, credentials).cards(primaryKey!),
    },
  },
  [DASHBOARD_CARD]: {
    record: {
      read: (owner, _ranges, _facts, credentials, primaryKey) =>
        createDashboardCardOwnerReadAdapter(owner, credentials).record(primaryKey!),
    },
  },
  [FAVORITE]: {
    status: {
      read: (owner, _ranges, _facts, credentials, _key, params) => createFavoriteReadAdapter(owner, credentials)
        .status(params as Parameters<ReturnType<typeof createFavoriteReadAdapter>["status"]>[0]),
    },
    dashboardCardsStatus: {
      read: (owner, _ranges, _facts, credentials) => createFavoriteReadAdapter(owner, credentials).dashboardCardsStatus(),
    },
  },
  [AGENT_SESSION]: {
    list: {
      read: (owner, _ranges, _facts, credentials, _key, params) => createAgentSessionReadAdapter(owner, credentials)
        .list(params as Parameters<ReturnType<typeof createAgentSessionReadAdapter>["list"]>[0]),
    },
    record: {
      read: (owner, _ranges, _facts, credentials, primaryKey) =>
        createAgentSessionReadAdapter(owner, credentials).record(primaryKey!),
    },
  },
  [FEEDBACK_RECORD]: {
    query: managedOpsRead(createRegisteredFeedbackReadAdapter, (reads, _key, params) => reads.query(params)),
    counts: managedOpsRead(createRegisteredFeedbackReadAdapter, (reads, _key, params) => reads.counts(params)),
    record: managedOpsRead(createRegisteredFeedbackReadAdapter, (reads, key) => reads.record(key)),
  },
  [EXTERNAL_MCP_SERVICE]: {
    list: externalMcpDirectoryRead(reads => reads.list()),
    record: externalMcpDirectoryRead((reads, key) => reads.record(key)),
    tools: {
      readJavaFacts: true,
      read: (owner, _ranges, facts, credentials, key) => readRegisteredExternalMcpTools(owner, credentials.locale, facts, key!),
    },
    options: {
      read: (owner, _ranges, _facts, credentials) => createExternalMcpReads(owner, credentials).options(),
    },
    resolve: {
      read: (owner, _ranges, _facts, credentials, _key, params) =>
        createExternalMcpReads(owner, credentials).resolve(params.values as readonly unknown[]),
    },
    form: managedOpsRead(createRegisteredExternalMcpFormReads, (reads, key, params) =>
      reads.form(key, params as Parameters<typeof reads.form>[1])),
    createForm: managedOpsRead(createRegisteredExternalMcpFormReads, (reads, _key, params) =>
      reads.createForm(params as Parameters<typeof reads.createForm>[0])),
  },
  [OPS_KNOWLEDGE]: {
    files: {
      readJavaFacts: true,
      async read(_owner, _ranges, facts, credentials) {
        return createRegisteredOpsKnowledgeReadAdapter(facts, credentials.locale).files();
      },
    },
    record: {
      readJavaFacts: true,
      async read(_owner, _ranges, facts, credentials, _key, params) {
        return createRegisteredOpsKnowledgeReadAdapter(facts, credentials.locale).record(params.path as string);
      },
    },
  },
  [DSL_QUERY]: {
    form: managedOpsRead(createRegisteredDslQueryReadAdapter, (reads, _key, params) => {
      const inputs = params as NonNullable<Parameters<typeof reads.form>[0]>;
      requireFormFieldNames(inputs.values, "values");
      return reads.form(inputs);
    }),
  },
  [TURN_EVIDENCE]: {
    list: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, _key, params) =>
      reads.list({ search: params.search as string | undefined })),
    record: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, key) => reads.record(key)),
    evidenceRuns: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, key) => reads.evidenceRuns(key)),
    evidenceGaps: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, key) => reads.evidenceGaps(key)),
    files: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, key) => reads.files(key)),
    file: managedOpsRead(createRegisteredTurnEvidenceReadAdapter, (reads, key, params) => reads.file(key, params.path as string)),
  },
  [AUTOTEST_CASE_SET]: {
    list: managedOpsRead(createRegisteredAutotestCaseSetReadAdapter, (reads, _key, params) =>
      reads.list({ search: params.search as string | undefined })),
    record: managedOpsRead(createRegisteredAutotestCaseSetReadAdapter, (reads, key) => reads.record(key)),
    form: managedOpsRead(createRegisteredAutotestCaseSetReadAdapter, (reads, key, params) => {
      const inputs = params as NonNullable<Parameters<typeof reads.form>[1]>;
      requireFormFieldNames(inputs.values, "values");
      return reads.form(key, inputs);
    }),
  },
  [AUTOTEST_RUN]: {
    list: managedOpsRead(createRegisteredAutotestRunReadAdapter, reads => reads.list()),
    record: managedOpsRead(createRegisteredAutotestRunReadAdapter, (reads, key) => reads.record(key)),
    results: managedOpsRead(createRegisteredAutotestRunReadAdapter, (reads, key, params) =>
      reads.results(key, params as Parameters<typeof reads.results>[1])),
  },
  [AUTOTEST_CASE_ARTIFACT]: {
    record: managedOpsRead(createRegisteredAutotestCaseArtifactReadAdapter, (reads, key) => reads.record(key)),
    evidenceRuns: managedOpsRead(createRegisteredAutotestCaseArtifactReadAdapter, (reads, key) => reads.evidenceRuns(key)),
    evidenceGaps: managedOpsRead(createRegisteredAutotestCaseArtifactReadAdapter, (reads, key) => reads.evidenceGaps(key)),
    files: managedOpsRead(createRegisteredAutotestCaseArtifactReadAdapter, (reads, key) => reads.files(key)),
    file: managedOpsRead(createRegisteredAutotestCaseArtifactReadAdapter, (reads, key, params) =>
      reads.file(key, params.path as string)),
  },
  [SDK_COMPONENT]: {
    count: {
      visibility: [{ kind: "COMPONENT", verbs: ["USE"] }],
      read: (owner, ranges) => countSdkComponentsInRange(owner.domainId, ranges!.COMPONENT.USE),
    },
    catalogue: sdkComponentUseRead((owner, _key, credentials, range, params) =>
      listSdkComponents(owner, credentials, params.search as string | undefined, range)),
    definition: sdkComponentUseRead(readSdkComponent),
    record: sdkComponentUseRead(readSdkComponentRecord),
    dataRows: sdkComponentUseRead(readSdkComponentDataRows),
    configRows: sdkComponentUseRead(readSdkComponentConfigRows),
    inputRows: sdkComponentUseRead(readSdkComponentInputRows),
    outputRows: sdkComponentUseRead(readSdkComponentOutputRows),
    operationRows: sdkComponentUseRead(readSdkComponentOperationRows),
  },
};
