import { workbenchManagement, type WorkbenchManagementOperation } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelDownloadReceiptSchema } from "@ontomato/contracts/panel-download";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import {
  panelReadOperationInputSchema,
  panelReadOperationSectionsResultSchema,
  type PanelReadOperationRecordCell,
  type PanelReadOperationRecordColumn,
} from "@ontomato/contracts/panel-operations";
import {
  AUTOTEST_CASE_ARTIFACT,
  AUTOTEST_RUN,
  BUILD_TURN_EVIDENCE,
  DELETE_AUTOTEST_RUN,
  DELETE_TURN_EVIDENCE,
  DOWNLOAD_AUTOTEST_CASE_ARTIFACT,
  DOWNLOAD_AUTOTEST_RUN,
  DOWNLOAD_TURN_EVIDENCE,
  DSL_QUERY,
  EXECUTE_DSL_QUERY,
  KEEP_AUTOTEST_RUN,
  KEEP_TURN_EVIDENCE,
  REFRESH_TURN_EVIDENCE,
  TURN_EVIDENCE,
  UNKEEP_AUTOTEST_RUN,
  UNKEEP_TURN_EVIDENCE,
} from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import { parseTurnKey } from "../../logging/log-context";
import { executeDslViaBackend, hasDslExecutionError } from "../data-query/dsl-executor";
import {
  collectDslResultSections,
  describeDslResultSections,
  registerDslResultSectionProvider,
  type DslResultSectionContext,
  type DslResultSectionProvider,
} from "./dsl-result-sections";
import { autotestConfig } from "../../platform/diagnosis/autotest/config";
import {
  deleteRun,
  hasActiveRunArtifactWrites,
  isAutotestResultId,
  loadRunMeta,
  loadRunMetaForDomain,
} from "../../platform/diagnosis/autotest/results/store";
import { getActiveRun } from "../../platform/diagnosis/autotest/runner/run-controller";
import {
  clearArtifactRetentionBestEffort,
  getArtifactRetentionSnapshot,
  setArtifactKept,
} from "../../platform/diagnosis/observe/artifact-retention/store";
import { hasArtifactRetention } from "../../platform/diagnosis/observe/artifact-retention/types";
import {
  addDirToZip,
  createWorkspaceZip,
  loadManifestAtArtifactDir,
  resolveCaseArtifactDir,
} from "../../platform/diagnosis/observe/workspaces/artifact-file";
import { assistantEvidenceReader } from "../../platform/diagnosis/observe/workspaces/assistant-source";
import { buildTurnWorkspace } from "../../platform/diagnosis/observe/workspaces/builder";
import { deleteWorkspace, isWorkspaceId, loadManifest } from "../../platform/diagnosis/observe/workspaces/store";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelReadServerOperation,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { parseAutotestCaseArtifactKey, requireDslQueryAccess } from "./panel-reads";
import { autotestCaseSetServerOperations } from "./case-sets-panel";

const emptyInputSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();

const turnTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(TURN_EVIDENCE),
  primaryKey: z.string().min(1),
}).strict();

const autotestRunTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(AUTOTEST_RUN),
  primaryKey: z.string().min(1),
}).strict();

const caseArtifactTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.literal(AUTOTEST_CASE_ARTIFACT),
  primaryKey: z.string().min(1),
}).strict();

const buildTurnInputSchema = z.object({
  turnKey: z.string().trim().min(1),
}).strict();

const buildTurnResultSchema = z.object({
  turnKey: z.string().min(1),
}).strict();

function sanitizeDownloadBase(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || fallback;
}

function refusalFromError(error: unknown, fallbackCode: string, fallbackMessage: string): SinglePanelOperationOutcome {
  if (error instanceof HttpError && error.status < 500) {
    return {
      kind: "refusal",
      code: error.code ?? fallbackCode,
      message: error.message || fallbackMessage,
    };
  }
  throw error;
}

async function verifyOwnedTurn(operation: WorkbenchManagementOperation, host: PanelOperationHost, turnKey: string): Promise<{ domainId: string }> {
  const { owner, credentials } = host.executor;
  await assertManagement(operation, owner, credentials);
  const { domainId } = owner;
  if (!parseTurnKey(turnKey)) throw new HttpError(400, "Invalid turnKey");
  const manifest = loadManifest(turnKey);
  if (!manifest || manifest.domainId !== domainId) {
    throw new HttpError(404, "Turn workspace not found");
  }
  return { domainId };
}

async function verifyOwnedRun(operation: WorkbenchManagementOperation, host: PanelOperationHost, runId: string): Promise<{ domainId: string; status: string }> {
  const { owner, credentials } = host.executor;
  await assertManagement(operation, owner, credentials);
  const { domainId } = owner;
  let meta;
  try {
    meta = loadRunMeta(runId);
  } catch {
    throw new HttpError(400, "Invalid runId");
  }
  if (!meta || meta.domainId !== domainId) {
    throw new HttpError(404, "Test run not found");
  }
  return { domainId, status: meta.status };
}

async function turnLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  const manifest = loadManifest(target.primaryKey);
  if (manifest && manifest.domainId === host.initiator.owner.domainId) {
    return manifest.question?.replace(/\s+/g, " ").trim() || manifest.turnKey || target.primaryKey;
  }
  return target.primaryKey;
}

async function runLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  try {
    const meta = loadRunMeta(target.primaryKey);
    if (meta && meta.domainId === host.initiator.owner.domainId) {
      return meta.caseSetName || meta.runId;
    }
  } catch {
    // Fall back to primaryKey when the ID cannot be resolved.
  }
  return target.primaryKey;
}

const deleteTurnImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_TURN_EVIDENCE}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    await assertManagement(workbenchManagement.opsTurnEvidenceDelete, host.initiator.owner, host.initiator.credentials);
    const label = await turnLabel(host, target);
    return {
      summary: tForLocale(host.locale, "panels.ops.confirmDeleteTurn", { id: label }),
      objects: [{ target: { objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

const deleteAutotestRunImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_AUTOTEST_RUN}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    await assertManagement(workbenchManagement.opsRunsDelete, host.initiator.owner, host.initiator.credentials);
    const label = await runLabel(host, target);
    return {
      summary: tForLocale(host.locale, "panels.ops.confirmDeleteRun", { id: label }),
      objects: [{ target: { objectType: AUTOTEST_RUN, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

function retentionUnavailableReason(locale: string | undefined, currentlyKept: boolean, wantKept: boolean) {
  if (wantKept === currentlyKept) {
    return { reason: tForLocale(locale, wantKept ? "panels.ops.alreadyKept" : "panels.ops.notKept") };
  }
}

function retentionUnavailable(artifactType: "turn-workspace" | "autotest-run", wantKept: boolean) {
  return {
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget | null) {
      if (!target) return undefined;
      const keptKeys = await getArtifactRetentionSnapshot();
      return retentionUnavailableReason(host.locale, hasArtifactRetention(keptKeys, artifactType, target.primaryKey), wantKept);
    },
    async unavailableBatch(
      host: PanelOperationHost,
      targets: readonly { target: PanelRecordTarget; rowKey: string }[],
    ) {
      const keptKeys = await getArtifactRetentionSnapshot();
      const reasons = new Map<string, { reason: string }>();
      for (const { target, rowKey } of targets) {
        const reason = retentionUnavailableReason(host.locale, hasArtifactRetention(keptKeys, artifactType, target.primaryKey), wantKept);
        if (reason) reasons.set(rowKey, reason);
      }
      return reasons;
    },
  };
}

export function turnRetentionUnavailable(operation: string, locale: string | undefined, kept: boolean) {
  if (operation === KEEP_TURN_EVIDENCE || operation === UNKEEP_TURN_EVIDENCE)
    return retentionUnavailableReason(locale, kept, operation === KEEP_TURN_EVIDENCE);
}

export function autotestRunOperationUnavailable(
  operation: string, locale: string | undefined, run: { runId: string; status: string; kept: boolean },
) {
  if (operation === DELETE_AUTOTEST_RUN) {
    return isRunBusy(run.runId, run.status) ? { reason: tForLocale(locale, "panels.ops.errors.runBusy") } : undefined;
  }
  return retentionUnavailableReason(locale, run.kept, operation === KEEP_AUTOTEST_RUN);
}

function visibleTurnManifest(domainId: string, turnKey: string) {
  const manifest = loadManifest(turnKey);
  return manifest?.domainId === domainId ? manifest : undefined;
}

function downloadUnavailableReason(locale: string | undefined, hasEvidence: boolean) {
  if (!hasEvidence) return { reason: tForLocale(locale, "panels.ops.errors.noEvidenceToDownload") };
}

function caseArtifactHasEvidence(domainId: string, { runId, caseId }: ReturnType<typeof parseAutotestCaseArtifactKey>) {
  const meta = loadRunMeta(runId);
  if (!meta || meta.domainId !== domainId) return undefined;
  const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
  return artifactDir !== null && Boolean(loadManifestAtArtifactDir(artifactDir, "")?.evidence);
}

export function prepareOpsEvidenceAvailability(operation: string, domainId: string, ids: string[], locale?: string) {
  if (operation === DOWNLOAD_AUTOTEST_CASE_ARTIFACT) {
    const keys = ids.map(id => {
      const key = parseAutotestCaseArtifactKey(id);
      if (!isAutotestResultId(key.runId))
        throw new HttpError(400, "Invalid case artifact key");
      return key;
    });
    return {
      type: AUTOTEST_CASE_ARTIFACT,
      approval: workbenchManagement.opsRunsRead.id,
      async read() {
        return keys.map(key => {
          const hasEvidence = caseArtifactHasEvidence(domainId, key);
          return hasEvidence === undefined ? { reason: "Test run not found" } : downloadUnavailableReason(locale, hasEvidence);
        });
      },
    };
  }
  if (operation === KEEP_AUTOTEST_RUN || operation === UNKEEP_AUTOTEST_RUN || operation === DELETE_AUTOTEST_RUN) {
    if (ids.some(id => !isAutotestResultId(id))) throw new HttpError(400, "Invalid runId");
    return {
      type: AUTOTEST_RUN,
      approval: workbenchManagement.opsRunsRead.id,
      async read() {
        const runs = ids.map(id => {
          const meta = loadRunMetaForDomain(id, domainId);
          if (!meta) throw new HttpError(403, tForLocale(locale, "panels.ops.errors.runNotFound"));
          return meta;
        });
        const kept = operation === DELETE_AUTOTEST_RUN ? [] : await getArtifactRetentionSnapshot();
        return runs.map(({ runId, status }) => autotestRunOperationUnavailable(operation, locale, {
          runId, status, kept: hasArtifactRetention(kept, "autotest-run", runId),
        }));
      },
    };
  }
  if (operation !== DOWNLOAD_TURN_EVIDENCE && operation !== KEEP_TURN_EVIDENCE && operation !== UNKEEP_TURN_EVIDENCE) return;
  for (const id of ids) {
    if (!parseTurnKey(id) || !isWorkspaceId(id)) throw new HttpError(400, "Invalid turnKey");
  }
  return {
    type: TURN_EVIDENCE,
    approval: workbenchManagement.opsTurnEvidenceRead.id,
    async read() {
      const manifests = ids.map(id => visibleTurnManifest(domainId, id));
      const keptKeys = operation !== DOWNLOAD_TURN_EVIDENCE && manifests.some(Boolean) ? await getArtifactRetentionSnapshot() : [];
      return ids.map((id, index) => {
        const manifest = manifests[index];
        if (!manifest) return { reason: "Turn workspace not found" };
        return operation === DOWNLOAD_TURN_EVIDENCE
          ? downloadUnavailableReason(locale, Boolean(manifest.evidence))
          : turnRetentionUnavailable(operation, locale, hasArtifactRetention(keptKeys, "turn-workspace", id));
      });
    },
  };
}

function isRunBusy(runId: string, status?: string): boolean {
  return getActiveRun()?.runId === runId || status === "running" || status === "stopping" || hasActiveRunArtifactWrites(runId);
}

export const opsDiagnosisWriteOperations = [
  {
    handlerRef: BUILD_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.buildTurn",
    kind: "action",
    binding: { kind: "PlatformOperation", id: BUILD_TURN_EVIDENCE },
    effect: "write",
    batch: false,
    targetType: TURN_EVIDENCE,
    targetSchema: z.null(),
    inputSchema: buildTurnInputSchema,
    resultSchema: buildTurnResultSchema,
    describeLocalInputSchema(locale) {
      return {
        type: "object",
        properties: {
          turnKey: {
            type: "string",
            minLength: 1,
            title: tForLocale(locale, "panels.ops.fields.turnKey"),
            description: tForLocale(locale, "panels.ops.fields.turnKeyHint"),
          },
        },
        required: ["turnKey"],
        additionalProperties: false,
      };
    },
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { turnKey } = buildTurnInputSchema.parse(input);
      const { owner, credentials } = host.executor;
      try {
        await assertManagement(workbenchManagement.opsTurnEvidenceBuild, owner, credentials);
        const { domainId } = owner;
        const turn = parseTurnKey(turnKey);
        if (!turn) throw new HttpError(400, "Invalid turnKey");
        const existing = loadManifest(turnKey);
        if (existing && existing.domainId !== domainId) {
          throw new HttpError(403, "Workspace access denied");
        }
        await assistantEvidenceReader().verifyDomain(turn.threadId, domainId);
        await buildTurnWorkspace({
          turnKey,
          domainId,
          userId: owner.userId,
          token: credentials.token,
          apiKey: credentials.apiKey,
        });
        return {
          kind: "success",
          message: tForLocale(host.locale, "panels.ops.done.turnBuilt", { id: turnKey }),
          data: { turnKey },
          created: { objectType: TURN_EVIDENCE, primaryKey: turnKey },
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: turnKey }],
            objectTypes: [TURN_EVIDENCE],
          },
        };
      } catch (error) {
        return refusalFromError(error, "TURN_BUILD_REFUSED", tForLocale(host.locale, "panels.ops.errors.buildTurnFailed"));
      }
    },
  },
  {
    handlerRef: REFRESH_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.refreshTurn",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REFRESH_TURN_EVIDENCE },
    effect: "write",
    batch: false,
    targetType: TURN_EVIDENCE,
    targetInput: "turn",
    targetSchema: turnTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: turnLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.turnRefreshed", { name }),
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Refresh acts on a selected turn evidence workspace");
      const { owner, credentials } = host.executor;
      try {
        const { domainId } = await verifyOwnedTurn(workbenchManagement.opsTurnEvidenceRefresh, host, target.primaryKey);
        const turn = parseTurnKey(target.primaryKey)!;
        await assistantEvidenceReader().verifyDomain(turn.threadId, domainId);
        await buildTurnWorkspace({
          turnKey: target.primaryKey,
          domainId,
          userId: owner.userId,
          token: credentials.token,
          apiKey: credentials.apiKey,
        });
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }],
            objectTypes: [TURN_EVIDENCE],
          },
        };
      } catch (error) {
        return refusalFromError(error, "TURN_REFRESH_REFUSED", tForLocale(host.locale, "panels.ops.errors.buildTurnFailed"));
      }
    },
  },
  {
    handlerRef: KEEP_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.keep",
    kind: "action",
    binding: { kind: "PlatformOperation", id: KEEP_TURN_EVIDENCE },
    effect: "write",
    batch: false,
    targetType: TURN_EVIDENCE,
    targetInput: "turn",
    targetSchema: turnTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: turnLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.kept", { name }),
    ...retentionUnavailable("turn-workspace", true),
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Keep acts on a selected turn evidence workspace");
      try {
        await verifyOwnedTurn(workbenchManagement.opsTurnEvidenceRetention, host, target.primaryKey);
        await setArtifactKept("turn-workspace", target.primaryKey, true);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }],
            objectTypes: [TURN_EVIDENCE],
          },
        };
      } catch (error) {
        return refusalFromError(error, "RETENTION_REFUSED", tForLocale(host.locale, "panels.ops.errors.retentionFailed"));
      }
    },
  },
  {
    handlerRef: UNKEEP_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.unkeep",
    kind: "action",
    binding: { kind: "PlatformOperation", id: UNKEEP_TURN_EVIDENCE },
    effect: "write",
    batch: false,
    targetType: TURN_EVIDENCE,
    targetInput: "turn",
    targetSchema: turnTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: turnLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.unkept", { name }),
    ...retentionUnavailable("turn-workspace", false),
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Unkeep acts on a selected turn evidence workspace");
      try {
        await verifyOwnedTurn(workbenchManagement.opsTurnEvidenceRetention, host, target.primaryKey);
        await setArtifactKept("turn-workspace", target.primaryKey, false);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }],
            objectTypes: [TURN_EVIDENCE],
          },
        };
      } catch (error) {
        return refusalFromError(error, "RETENTION_REFUSED", tForLocale(host.locale, "panels.ops.errors.retentionFailed"));
      }
    },
  },
  {
    handlerRef: DELETE_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.deleteTurn",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_TURN_EVIDENCE },
    effect: "write",
    batch: false,
    targetType: TURN_EVIDENCE,
    targetInput: "turn",
    targetSchema: turnTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: turnLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.turnDeleted", { name }),
    inspectImpact: deleteTurnImpact,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected turn evidence workspace");
      try {
        await verifyOwnedTurn(workbenchManagement.opsTurnEvidenceDelete, host, target.primaryKey);
        const deleted = deleteWorkspace(target.primaryKey);
        if (!deleted) {
          return { kind: "refusal", code: "NOT_FOUND", message: tForLocale(host.locale, "panels.ops.errors.turnNotFound") };
        }
        await clearArtifactRetentionBestEffort("turn-workspace", target.primaryKey);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }],
            objectTypes: [TURN_EVIDENCE],
            removed: [{ objectType: TURN_EVIDENCE, primaryKey: target.primaryKey }],
          },
        };
      } catch (error) {
        return refusalFromError(error, "TURN_DELETE_REFUSED", tForLocale(host.locale, "panels.ops.errors.deleteFailed"));
      }
    },
  },
  {
    handlerRef: KEEP_AUTOTEST_RUN,
    labelKey: "panels.ops.actions.keep",
    kind: "action",
    binding: { kind: "PlatformOperation", id: KEEP_AUTOTEST_RUN },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_RUN,
    targetInput: "run",
    targetSchema: autotestRunTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: runLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.kept", { name }),
    ...retentionUnavailable("autotest-run", true),
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Keep acts on a selected test run");
      try {
        await verifyOwnedRun(workbenchManagement.opsRunsRetention, host, target.primaryKey);
        await setArtifactKept("autotest-run", target.primaryKey, true);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: AUTOTEST_RUN, primaryKey: target.primaryKey }],
            objectTypes: [AUTOTEST_RUN],
          },
        };
      } catch (error) {
        return refusalFromError(error, "RETENTION_REFUSED", tForLocale(host.locale, "panels.ops.errors.retentionFailed"));
      }
    },
  },
  {
    handlerRef: UNKEEP_AUTOTEST_RUN,
    labelKey: "panels.ops.actions.unkeep",
    kind: "action",
    binding: { kind: "PlatformOperation", id: UNKEEP_AUTOTEST_RUN },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_RUN,
    targetInput: "run",
    targetSchema: autotestRunTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: runLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.unkept", { name }),
    ...retentionUnavailable("autotest-run", false),
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Unkeep acts on a selected test run");
      try {
        await verifyOwnedRun(workbenchManagement.opsRunsRetention, host, target.primaryKey);
        await setArtifactKept("autotest-run", target.primaryKey, false);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: AUTOTEST_RUN, primaryKey: target.primaryKey }],
            objectTypes: [AUTOTEST_RUN],
          },
        };
      } catch (error) {
        return refusalFromError(error, "RETENTION_REFUSED", tForLocale(host.locale, "panels.ops.errors.retentionFailed"));
      }
    },
  },
  {
    handlerRef: DELETE_AUTOTEST_RUN,
    labelKey: "panels.ops.actions.deleteRun",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_AUTOTEST_RUN },
    effect: "write",
    batch: false,
    targetType: AUTOTEST_RUN,
    targetInput: "run",
    targetSchema: autotestRunTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetLabel: runLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ops.done.runDeleted", { name }),
    inspectImpact: deleteAutotestRunImpact,
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget | null) {
      if (!target) return undefined;
      try {
        const meta = loadRunMeta(target.primaryKey);
        if (meta && meta.domainId === host.initiator.owner.domainId && isRunBusy(target.primaryKey, meta.status)) {
          return { reason: tForLocale(host.locale, "panels.ops.errors.runBusy") };
        }
      } catch {
        // Ignore invalid target lookup here; execute reports the refusal.
      }
      return undefined;
    },
    async unavailableBatch(host: PanelOperationHost, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) {
      const reasons = new Map<string, { reason: string } | undefined>();
      for (const { target, rowKey } of targets) {
        try {
          const meta = loadRunMeta(target.primaryKey);
          if (meta && meta.domainId === host.initiator.owner.domainId && isRunBusy(target.primaryKey, meta.status)) {
            reasons.set(rowKey, { reason: tForLocale(host.locale, "panels.ops.errors.runBusy") });
          }
        } catch {
          // Ignore invalid target lookup.
        }
      }
      return reasons;
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected test run");
      try {
        const { status } = await verifyOwnedRun(workbenchManagement.opsRunsDelete, host, target.primaryKey);
        if (isRunBusy(target.primaryKey, status)) {
          return {
            kind: "refusal",
            code: "RUN_BUSY",
            message: tForLocale(host.locale, "panels.ops.errors.runBusy"),
          };
        }
        const deleted = deleteRun(target.primaryKey);
        if (!deleted) {
          return { kind: "refusal", code: "NOT_FOUND", message: tForLocale(host.locale, "panels.ops.errors.runNotFound") };
        }
        await clearArtifactRetentionBestEffort("autotest-run", target.primaryKey);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [{ objectType: AUTOTEST_RUN, primaryKey: target.primaryKey }],
            objectTypes: [AUTOTEST_RUN],
            removed: [{ objectType: AUTOTEST_RUN, primaryKey: target.primaryKey }],
          },
        };
      } catch (error) {
        return refusalFromError(error, "RUN_DELETE_REFUSED", tForLocale(host.locale, "panels.ops.errors.deleteFailed"));
      }
    },
  },
] satisfies readonly PanelServerOperation[];

function describeDslTable(locale?: string) {
  return {
    id: "table",
    label: tForLocale(locale, "panels.ops.dsl.dataTable"),
    emptyText: tForLocale(locale, "panels.ops.dsl.noData"),
    kind: "records",
  } as const;
}

function describeDslRawResponse(locale?: string) {
  return {
    id: "raw",
    label: tForLocale(locale, "panels.ops.dsl.rawResponse"),
    emptyText: tForLocale(locale, "panels.ops.dsl.noResponse"),
    kind: "json",
  } as const;
}

function parseDslDraftObject(raw: unknown, locale?: string): Record<string, unknown> {
  let candidate: unknown = raw;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) {
      throw new HttpError(422, tForLocale(locale, "panels.ops.dsl.emptyInput"), "INVALID_DSL_QUERY");
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new HttpError(
        422,
        tForLocale(locale, "panels.ops.dsl.invalidJson", { message: detail }),
        "INVALID_DSL_QUERY",
      );
    }
  }
  const unwrapped = Array.isArray(candidate) ? candidate[0] : candidate;
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    throw new HttpError(422, tForLocale(locale, "panels.ops.dsl.mustBeObject"), "INVALID_DSL_QUERY");
  }
  return unwrapped as Record<string, unknown>;
}

function toRecordCell(value: unknown): PanelReadOperationRecordCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractDslAnswerTable(payload: unknown): {
  columns: PanelReadOperationRecordColumn[];
  rows: Record<string, PanelReadOperationRecordCell>[];
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { columns: [], rows: [] };
  }
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) return { columns: [], rows: [] };
  const first = data[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return { columns: [], rows: [] };
  const answer = (first as Record<string, unknown>).answer;
  if (!Array.isArray(answer) || answer.length === 0) return { columns: [], rows: [] };

  const columnKeys: string[] = [];
  const seen = new Set<string>();
  const objectRows: Record<string, unknown>[] = [];
  for (const item of answer) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    objectRows.push(record);
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columnKeys.push(key);
    }
  }
  const columns: PanelReadOperationRecordColumn[] = columnKeys.map((key) => ({ key, label: key }));
  const rows = objectRows.map((record) => {
    const row: Record<string, PanelReadOperationRecordCell> = {};
    for (const key of columnKeys) {
      row[key] = toRecordCell(record[key]);
    }
    return row;
  });
  return { columns, rows };
}

function toSafeRuntimeJsonValue(value: unknown): RuntimeJsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as RuntimeJsonValue;
  } catch {
    return String(value);
  }
}

export const opsDiagnosisReadOperations = [
  {
    handlerRef: DOWNLOAD_TURN_EVIDENCE,
    labelKey: "panels.ops.actions.download",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DOWNLOAD_TURN_EVIDENCE },
    effect: "read",
    batch: false,
    targetType: TURN_EVIDENCE,
    target: { source: "input", input: "turn" },
    targetSchema: turnTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: panelDownloadReceiptSchema,
    async unavailable(host, target) {
      if (!target) return undefined;
      const manifest = visibleTurnManifest(host.initiator.owner.domainId, target.primaryKey);
      if (manifest) return downloadUnavailableReason(host.locale, Boolean(manifest.evidence));
    },
    async execute(host, call) {
      const { primaryKey } = turnTargetSchema.parse(call.target);
      await verifyOwnedTurn(workbenchManagement.opsTurnEvidenceRead, host, primaryKey);
      const buffer = createWorkspaceZip(primaryKey);
      if (!buffer) {
        throw new HttpError(409, tForLocale(host.locale, "panels.ops.errors.noEvidenceToDownload"), "NO_EVIDENCE");
      }
      return {
        kind: "file",
        bytes: new Uint8Array(buffer),
        mime: "application/zip",
        suggestedName: `${sanitizeDownloadBase(primaryKey, "turn-evidence")}.zip`,
      };
    },
  },
  {
    handlerRef: DOWNLOAD_AUTOTEST_RUN,
    labelKey: "panels.ops.actions.downloadResults",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DOWNLOAD_AUTOTEST_RUN },
    effect: "read",
    batch: false,
    targetType: AUTOTEST_RUN,
    target: { source: "input", input: "run" },
    targetSchema: autotestRunTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: panelDownloadReceiptSchema,
    async execute(host, call) {
      const { primaryKey } = autotestRunTargetSchema.parse(call.target);
      await verifyOwnedRun(workbenchManagement.opsRunsRead, host, primaryKey);
      const runDir = path.join(autotestConfig.dataDir, "runs", primaryKey);
      if (!fs.existsSync(runDir)) {
        throw new HttpError(404, "Artifacts not found");
      }
      const zip = new AdmZip();
      addDirToZip(zip, runDir, primaryKey);
      return {
        kind: "file",
        bytes: new Uint8Array(zip.toBuffer()),
        mime: "application/zip",
        suggestedName: `${sanitizeDownloadBase(primaryKey, "autotest-run")}.zip`,
      };
    },
  },
  {
    handlerRef: DOWNLOAD_AUTOTEST_CASE_ARTIFACT,
    labelKey: "panels.ops.actions.download",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DOWNLOAD_AUTOTEST_CASE_ARTIFACT },
    effect: "read",
    batch: false,
    targetType: AUTOTEST_CASE_ARTIFACT,
    target: { source: "input", input: "caseArtifact" },
    targetSchema: caseArtifactTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: panelDownloadReceiptSchema,
    async unavailable(host, target) {
      if (!target) return undefined;
      try {
        const hasEvidence = caseArtifactHasEvidence(
          host.initiator.owner.domainId, parseAutotestCaseArtifactKey(target.primaryKey),
        );
        if (hasEvidence !== undefined) return downloadUnavailableReason(host.locale, hasEvidence);
      } catch {
        // Ignore lookup errors during availability check.
      }
      return undefined;
    },
    async execute(host, call) {
      const { primaryKey } = caseArtifactTargetSchema.parse(call.target);
      const { runId, caseId } = parseAutotestCaseArtifactKey(primaryKey);
      await verifyOwnedRun(workbenchManagement.opsRunsRead, host, runId);
      const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
      if (!artifactDir) throw new HttpError(404, "Case artifacts not found");
      const zip = new AdmZip();
      addDirToZip(zip, artifactDir, caseId);
      return {
        kind: "file",
        bytes: new Uint8Array(zip.toBuffer()),
        mime: "application/zip",
        suggestedName: `${sanitizeDownloadBase(`${runId}_${caseId}`, "case-artifacts")}.zip`,
      };
    },
  },
  {
    handlerRef: EXECUTE_DSL_QUERY,
    labelKey: "panels.ops.actions.executeDsl",
    kind: "action",
    binding: { kind: "PlatformOperation", id: EXECUTE_DSL_QUERY },
    effect: "read",
    batch: false,
    targetType: DSL_QUERY,
    target: { source: "draft" },
    targetSchema: panelFormTargetSchema.optional(),
    inputSchema: panelReadOperationInputSchema,
    resultSchema: panelReadOperationSectionsResultSchema,
    describeResultSections(locale) {
      return [describeDslTable(locale), ...describeDslResultSections(locale), describeDslRawResponse(locale)];
    },
    async execute(host, call) {
      await requireDslQueryAccess(workbenchManagement.opsDslExecute, host.executor.owner, host.executor.credentials);
      const locale = host.locale;
      const { draft } = panelReadOperationInputSchema.parse(call.input);
      const dslObject = parseDslDraftObject(draft.dsl, locale);
      const payload = await executeDslViaBackend(dslObject, host.executor.credentials.token ?? "");
      const hasError = hasDslExecutionError(payload);
      const sectionPayload = hasError ? undefined : payload;
      return {
        kind: "sections",
        ...(hasError && { defaultSectionId: "raw" }),
        sections: [
          { ...describeDslTable(locale), ...extractDslAnswerTable(sectionPayload) },
          ...collectDslResultSections({ payload: sectionPayload, locale }),
          { ...describeDslRawResponse(locale), value: toSafeRuntimeJsonValue(payload) },
        ],
      };
    },
  },
] satisfies readonly (PanelReadServerOperation & { labelKey: string })[];

export {
  registerDslResultSectionProvider,
  type DslResultSectionContext,
  type DslResultSectionProvider,
};

export const opsDiagnosisServerOperations: readonly PanelServerOperation[] = [
  ...opsDiagnosisWriteOperations,
  ...opsDiagnosisReadOperations,
  ...autotestCaseSetServerOperations,
];
