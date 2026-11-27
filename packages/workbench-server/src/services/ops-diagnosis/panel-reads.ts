import { z } from "zod";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import path from "node:path";
import type { KnowledgeTreeNode } from "@ontomato/contracts/diagnosis";
import type { ArtifactFileTreeNode, WorkspaceManifest } from "@ontomato/contracts/observe";
import type { RunCaseResult, RunMeta } from "@ontomato/contracts/autotest";
import {
  AUTOTEST_CASE_ARTIFACT,
  AUTOTEST_RUN,
  OPS_KNOWLEDGE,
  TURN_EVIDENCE,
} from "@ontomato/contracts/platform-object-types";
import type { PanelFormDescription, PanelFormValues, PanelRecord } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { parseTurnKey } from "../../logging/log-context";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { autotestConfig } from "../../platform/diagnosis/autotest/config";
import {
  computeSummary,
  listRuns,
  loadCaseResults,
  loadRunMeta,
  loadRunMetaForDomain,
  settleStaleRunMeta,
} from "../../platform/diagnosis/autotest/results/store";
import { getCaseVerdict, getCaseVerdictReason } from "../../platform/diagnosis/autotest/results/verdict";
import { getActiveRun } from "../../platform/diagnosis/autotest/runner/run-controller";
import {
  KnowledgeNotFoundError,
  KnowledgePathError,
  listKnowledgeTree,
  readKnowledgeMarkdown,
} from "../../platform/diagnosis/observe/agent/knowledge-store";
import { getArtifactRetentionSnapshot } from "../../platform/diagnosis/observe/artifact-retention/store";
import { hasArtifactRetention } from "../../platform/diagnosis/observe/artifact-retention/types";
import {
  buildArtifactFileTree,
  getFileTree,
  loadManifestAtArtifactDir,
  readPhysicalFilePreview,
  readWorkspaceFilePreview,
  resolveArtifactFilePath,
  resolveCaseArtifactDir,
} from "../../platform/diagnosis/observe/workspaces/artifact-file";
import { getCollectingTurnWorkspace, listCollectingTurnWorkspaces } from "../../platform/diagnosis/observe/workspaces/builder";
import { listWorkspaces, loadManifest } from "../../platform/diagnosis/observe/workspaces/store";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { withReadDirective } from "../product-panels/read-directive";

const CASE_ARTIFACT_KEY_SEPARATOR = "::";

export function encodeAutotestCaseArtifactKey(runId: string, caseId: string): string {
  return `${runId}${CASE_ARTIFACT_KEY_SEPARATOR}${caseId}`;
}

export function parseAutotestCaseArtifactKey(primaryKey: string): { runId: string; caseId: string } {
  const index = primaryKey.indexOf(CASE_ARTIFACT_KEY_SEPARATOR);
  if (index <= 0 || index >= primaryKey.length - CASE_ARTIFACT_KEY_SEPARATOR.length) {
    throw new HttpError(400, "Invalid case artifact key");
  }
  const runId = primaryKey.slice(0, index);
  const caseId = primaryKey.slice(index + CASE_ARTIFACT_KEY_SEPARATOR.length);
  if (!runId || !caseId || runId.includes("/") || caseId.includes("/") || runId.includes("..") || caseId.includes("..")) {
    throw new HttpError(400, "Invalid case artifact key");
  }
  return { runId, caseId };
}

export async function requireDslQueryAccess(
  operation: typeof workbenchManagement.opsDslRead | typeof workbenchManagement.opsDslExecute,
  owner: Pick<ProductOwner, "domainId">,
  viewer: AssistantCredentials,
): Promise<void> {
  try {
    await assertManagement(operation, owner, viewer);
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== "DEPENDENCY_UNAVAILABLE") throw error;
    const unavailable = new HttpError(503, error.message, error.code);
    unavailable.cause = error;
    throw unavailable;
  }
}

function flattenKnowledgeFiles(node: KnowledgeTreeNode, out: KnowledgeTreeNode[] = []): KnowledgeTreeNode[] {
  if (node.type === "file") {
    out.push(node);
    return out;
  }
  for (const child of node.children ?? []) {
    flattenKnowledgeFiles(child, out);
  }
  return out;
}

function flattenArtifactFiles(
  nodes: readonly ArtifactFileTreeNode[],
  out: ArtifactFileTreeNode[] = [],
): ArtifactFileTreeNode[] {
  for (const node of nodes) {
    if (node.type === "file") {
      out.push(node);
    } else if (node.children?.length) {
      flattenArtifactFiles(node.children, out);
    }
  }
  return out;
}

function formatJsonPreview(content: string, filePath: string): string {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".json") && !lower.endsWith(".jsonl")) return content;
  try {
    if (lower.endsWith(".jsonl")) {
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.stringify(JSON.parse(line), null, 2))
        .join("\n---\n");
    }
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatDurationText(ms?: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function localizedStatusLabel(status: string, locale?: string): string {
  switch (status) {
    case "running": return tForLocale(locale, "panels.ops.status.running");
    case "stopping": return tForLocale(locale, "panels.ops.status.stopping");
    case "completed": return tForLocale(locale, "panels.ops.status.completed");
    case "stopped": return tForLocale(locale, "panels.ops.status.stopped");
    case "failed": return tForLocale(locale, "panels.ops.status.failed");
    case "success": return tForLocale(locale, "panels.ops.status.success");
    case "error": return tForLocale(locale, "panels.ops.status.error");
    case "cancelled": return tForLocale(locale, "panels.ops.status.cancelled");
    case "collecting": return tForLocale(locale, "panels.ops.status.collecting");
    case "ready": return tForLocale(locale, "panels.ops.status.ready");
    default: return status;
  }
}

function localizedVerdictLabel(verdict: "correct" | "wrong" | "abnormal", locale?: string): string {
  switch (verdict) {
    case "correct": return tForLocale(locale, "panels.ops.verdict.correct");
    case "wrong": return tForLocale(locale, "panels.ops.verdict.wrong");
    case "abnormal": return tForLocale(locale, "panels.ops.verdict.abnormal");
  }
}

function statusTone(status: string): "info" | "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "running":
    case "collecting":
      return "info";
    case "completed":
    case "success":
    case "ready":
      return "success";
    case "stopping":
    case "stopped":
    case "cancelled":
      return "warning";
    case "failed":
    case "error":
      return "danger";
    default:
      return "default";
  }
}

function verdictTone(verdict: "correct" | "wrong" | "abnormal"): "success" | "danger" | "warning" {
  if (verdict === "correct") return "success";
  if (verdict === "wrong") return "danger";
  return "warning";
}

function summarizeRun(meta: RunMeta, results: readonly RunCaseResult[], locale?: string) {
  const effectiveResults = results.length > 0 ? results : [];
  const total = effectiveResults.length || meta.summary.total;
  let correct = 0;
  let wrong = 0;
  let abnormal = 0;
  let durationTotal = 0;
  let durationCount = 0;
  if (effectiveResults.length > 0) {
    for (const row of effectiveResults) {
      const verdict = getCaseVerdict(row);
      if (verdict === "correct") correct++;
      else if (verdict === "wrong") wrong++;
      else abnormal++;
      if (row.durationMs && row.durationMs > 0) {
        durationTotal += row.durationMs;
        durationCount++;
      }
    }
  } else {
    correct = meta.summary.correct ?? 0;
    wrong = meta.summary.wrong ?? 0;
    abnormal = meta.summary.abnormal ?? 0;
  }
  const evaluated = correct + wrong;
  const accuracyRate = evaluated > 0 ? `${((correct / evaluated) * 100).toFixed(1)}%` : "-";
  const avgMs = durationCount > 0 ? durationTotal / durationCount : 0;
  const avgDuration = formatDurationText(avgMs);
  const summaryLine = total > 0
    ? tForLocale(locale, "panels.ops.autotest.summaryLine", { total, rate: accuracyRate, avg: avgDuration })
    : tForLocale(locale, "panels.ops.autotest.emptySummary");
  return { total, correct, wrong, abnormal, accuracyRate, avgDuration, summaryLine };
}

function artifactEvidenceRuns(className: string, manifest: WorkspaceManifest, locale?: string): PanelRecord[] {
  const runs = manifest.evidence?.runs ?? [];
  return runs.map((run) => ({
    className,
    primaryKey: run.runId,
    label: run.owner,
    fields: {
      owner: run.owner,
      sessionId: run.sessionId,
      runId: run.runId,
      artifactIds: run.artifactIds.join("\n"),
    },
    fieldLabels: {
      owner: tForLocale(locale, "panels.ops.fields.owner"),
      sessionId: tForLocale(locale, "panels.ops.fields.sessionId"),
      runId: tForLocale(locale, "panels.ops.fields.runId"),
      artifactIds: tForLocale(locale, "panels.ops.fields.artifacts"),
    },
  }));
}

function artifactEvidenceGaps(className: string, manifest: WorkspaceManifest, locale?: string): PanelRecord[] {
  const gaps = manifest.evidence?.gaps ?? [];
  return gaps.map((gap, index) => ({
    className,
    primaryKey: `${gap.source}:${gap.code}:${index}`,
    label: gap.message,
    fields: {
      source: gap.source,
      code: gap.code,
      message: gap.message,
    },
    fieldLabels: {
      source: tForLocale(locale, "panels.ops.fields.source"),
      code: tForLocale(locale, "panels.ops.fields.code"),
      message: tForLocale(locale, "panels.ops.fields.message"),
    },
    tones: { message: "warning" },
  }));
}

function artifactFileRecords(className: string, nodes: readonly ArtifactFileTreeNode[], locale?: string): PanelRecord[] {
  return flattenArtifactFiles(nodes).map((node) => ({
    className,
    primaryKey: node.path,
    label: node.name,
    fields: {
      path: node.path,
      name: node.name,
      size: node.size ?? 0,
    },
    fieldLabels: {
      path: tForLocale(locale, "panels.ops.fields.path"),
      name: tForLocale(locale, "panels.ops.fields.name"),
      size: tForLocale(locale, "panels.ops.fields.size"),
    },
  }));
}

function assertValidRelativeFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized) || normalized.includes("\0")) {
    throw new HttpError(400, "Invalid file path");
  }
  return normalized;
}

function opsKnowledgeFileReads(locale?: string) {
  return {
    files(): PanelRecord[] {
      const root = listKnowledgeTree();
      return flattenKnowledgeFiles(root).map((node) => ({
        className: OPS_KNOWLEDGE,
        primaryKey: node.path,
        label: node.name,
        fields: {
          path: node.path,
          name: node.name,
        },
        fieldLabels: {
          path: tForLocale(locale, "panels.ops.fields.path"),
          name: tForLocale(locale, "panels.ops.fields.name"),
        },
      }));
    },
    record(filePath: string): PanelRecord {
      try {
        const file = readKnowledgeMarkdown(filePath);
        return {
          className: OPS_KNOWLEDGE,
          primaryKey: file.path,
          label: file.title,
          subtitle: file.path,
          fields: {
            path: file.path,
            title: file.title,
            content: file.content,
            updatedAt: file.updatedAt,
          },
          fieldLabels: {
            path: tForLocale(locale, "panels.ops.fields.path"),
            title: tForLocale(locale, "panels.ops.fields.title"),
            updatedAt: tForLocale(locale, "panels.ops.fields.updatedAt"),
          },
        };
      } catch (error) {
        if (error instanceof KnowledgePathError) throw new HttpError(400, error.message);
        if (error instanceof KnowledgeNotFoundError) throw new HttpError(404, error.message);
        throw error;
      }
    },
  };
}

export function createOpsKnowledgeReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const reads = opsKnowledgeFileReads(viewer.locale);
  const requireAccess = () => assertManagement(workbenchManagement.opsKnowledgeRead, owner, viewer);
  return {
    async files() {
      await requireAccess();
      return reads.files();
    },
    async record(filePath: string) {
      await requireAccess();
      return reads.record(filePath);
    },
  };
}

const opsKnowledgeReadApproval = z.literal(workbenchManagement.opsKnowledgeRead.id);

/** A ready Java batch item must carry the approval from the registered management read. */
export function createRegisteredOpsKnowledgeReadAdapter(javaFacts: unknown, locale?: string) {
  opsKnowledgeReadApproval.parse(javaFacts);
  return opsKnowledgeFileReads(locale);
}

function turnEvidenceReads(owner: ProductOwner, locale: string | undefined, requireAccess: () => Promise<void> | void) {
  async function requireTurnManifest(turnKey: string, includeCollecting = false): Promise<WorkspaceManifest> {
    await requireAccess();
    const domainId = owner.domainId;
    if (!parseTurnKey(turnKey)) throw new HttpError(400, "Invalid turnKey");
    const collecting = includeCollecting ? getCollectingTurnWorkspace(turnKey) : undefined;
    const manifest = collecting ?? loadManifest(turnKey);
    if (!manifest || manifest.domainId !== domainId) {
      throw new HttpError(404, "Turn workspace not found");
    }
    return manifest;
  }

  return {
    async list(params: { search?: string } = {}): Promise<PanelRecord[]> {
      await requireAccess();
      const domainId = owner.domainId;
      const keptKeys = await getArtifactRetentionSnapshot();
      const keyword = (params.search ?? "").trim().toLowerCase();
      const workspaces = [...listWorkspaces(), ...listCollectingTurnWorkspaces()]
        .filter((item) => item.domainId === domainId)
        .map((item) => [item.turnKey || item.workspaceId, item] as const);
      const rows = [...new Map(workspaces)]
        .map(([key, item]) => {
          const kept = hasArtifactRetention(keptKeys, "turn-workspace", key);
          return { item, key, kept };
        })
        .filter(({ item, key }) => {
          if (!keyword) return true;
          return key.toLowerCase().includes(keyword) || (item.question ?? "").toLowerCase().includes(keyword);
        })
        .sort((a, b) => {
          const collectingDiff = Number(b.item.status === "collecting") - Number(a.item.status === "collecting");
          if (collectingDiff !== 0) return collectingDiff;
          const keptDiff = Number(b.kept) - Number(a.kept);
          if (keptDiff !== 0) return keptDiff;
          return (b.item.createdAt || "").localeCompare(a.item.createdAt || "");
        });

      return rows.map(({ item, key, kept }) => {
        const question = item.question?.replace(/\s+/g, " ").trim() || key;
        const status = item.status || "ready";
        const tone = statusTone(status);
        return {
          className: TURN_EVIDENCE,
          primaryKey: key,
          label: question,
          subtitle: key,
          fields: {
            turnKey: key,
            question,
            status,
            statusLabel: localizedStatusLabel(status, locale),
            statusTone: tone,
            kept,
            keptLabel: kept ? tForLocale(locale, "panels.ops.kept") : "",
            createdAt: item.createdAt ?? "",
            hasEvidence: Boolean(item.evidence),
          },
          fieldLabels: {
            turnKey: tForLocale(locale, "panels.ops.fields.turnKey"),
            question: tForLocale(locale, "panels.ops.fields.question"),
            statusLabel: tForLocale(locale, "panels.ops.fields.status"),
            keptLabel: tForLocale(locale, "panels.ops.fields.retention"),
            createdAt: tForLocale(locale, "panels.ops.fields.createdAt"),
          },
          tones: {
            statusLabel: tone,
            hasEvidence: item.evidence ? "info" : "warning",
            ...(kept ? { keptLabel: "info" as const } : {}),
          },
        };
      });
    },

    async record(turnKey: string): Promise<PanelRecord> {
      const manifest = await requireTurnManifest(turnKey, true);
      const keptKeys = await getArtifactRetentionSnapshot();
      const key = manifest.turnKey || manifest.workspaceId;
      const kept = hasArtifactRetention(keptKeys, "turn-workspace", key);
      const hasEvidence = Boolean(manifest.evidence);
      const status = manifest.status || "ready";
      const tone = statusTone(status);
      const question = manifest.question?.replace(/\s+/g, " ").trim() || key;
      return {
        className: TURN_EVIDENCE,
        primaryKey: key,
        label: question,
        subtitle: key,
        fields: {
          turnKey: key,
          question,
          status,
          statusLabel: localizedStatusLabel(status, locale),
          statusTone: tone,
          kept,
          keptLabel: kept ? tForLocale(locale, "panels.ops.kept") : "",
          createdAt: manifest.createdAt ?? "",
          hasEvidence,
          evidenceHint: status === "collecting" ? "" : tForLocale(
            locale,
            hasEvidence ? "panels.ops.evidence.referenceHint" : "panels.ops.evidence.legacyHint",
          ),
          evidenceJson: manifest.evidence ? JSON.stringify(manifest.evidence, null, 2) : "",
          runCount: manifest.evidence?.runs.length ?? 0,
          gapCount: manifest.evidence?.gaps.length ?? 0,
        },
        fieldLabels: {
          turnKey: tForLocale(locale, "panels.ops.fields.turnKey"),
          statusLabel: tForLocale(locale, "panels.ops.fields.status"),
          keptLabel: tForLocale(locale, "panels.ops.fields.retention"),
          createdAt: tForLocale(locale, "panels.ops.fields.createdAt"),
          evidenceHint: tForLocale(locale, "panels.ops.fields.evidenceNote"),
        },
        tones: {
          statusLabel: tone,
          hasEvidence: hasEvidence ? "info" : "warning",
          ...(kept ? { keptLabel: "info" as const } : {}),
        },
        outputs: { status, kept, hasEvidence },
      };
    },

    async evidenceRuns(turnKey: string): Promise<PanelRecord[]> {
      const manifest = await requireTurnManifest(turnKey, true);
      return artifactEvidenceRuns(TURN_EVIDENCE, manifest, locale);
    },

    async evidenceGaps(turnKey: string): Promise<PanelRecord[]> {
      const manifest = await requireTurnManifest(turnKey, true);
      return artifactEvidenceGaps(TURN_EVIDENCE, manifest, locale);
    },

    async files(turnKey: string): Promise<PanelRecord[]> {
      const manifest = await requireTurnManifest(turnKey, true);
      if (manifest.status === "collecting") return [];
      const tree = getFileTree(turnKey);
      const nodes = tree ? (tree.children ?? [tree]) : [];
      return artifactFileRecords(TURN_EVIDENCE, nodes, locale);
    },

    async file(turnKey: string, filePath: string): Promise<PanelRecord> {
      await requireTurnManifest(turnKey);
      const safePath = assertValidRelativeFilePath(filePath);
      const preview = await readWorkspaceFilePreview(turnKey, safePath);
      if (!preview) throw new HttpError(404, "Artifact file not found");
      const name = path.posix.basename(safePath);
      return {
        className: TURN_EVIDENCE,
        primaryKey: safePath,
        label: name,
        subtitle: safePath,
        fields: {
          path: safePath,
          name,
          content: formatJsonPreview(preview.content, safePath),
          truncated: preview.truncated,
          size: preview.size,
          loadedBytes: preview.loadedBytes,
        },
        fieldLabels: {
          path: tForLocale(locale, "panels.ops.fields.path"),
          size: tForLocale(locale, "panels.ops.fields.size"),
        },
      };
    },
  };
}

export function createTurnEvidenceReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  return turnEvidenceReads(owner, viewer.locale, () => assertManagement(workbenchManagement.opsTurnEvidenceRead, owner, viewer));
}

export function createRegisteredTurnEvidenceReadAdapter(owner: ProductOwner, locale: string | undefined, javaFacts: unknown) {
  return turnEvidenceReads(owner, locale, () => {
    z.literal(workbenchManagement.opsTurnEvidenceRead.id).parse(javaFacts);
  });
}

const autotestRunReadDirective = { rereadAfterMs: 5000 };

function autotestRunReads(owner: ProductOwner, locale: string | undefined, requireAccess: () => Promise<void> | void) {
  async function requireRun(runId: string): Promise<{ domainId: string; meta: RunMeta; active: boolean }> {
    await requireAccess();
    const domainId = owner.domainId;
    let meta: RunMeta | null;
    try {
      meta = loadRunMetaForDomain(runId, domainId);
    } catch {
      throw new HttpError(400, "Invalid runId");
    }
    if (!meta) {
      throw new HttpError(404, "Test run not found");
    }
    const activeRun = getActiveRun();
    const isRunningHere = activeRun?.runId === runId;
    if (!isRunningHere && (meta.status === "running" || meta.status === "stopping")) {
      meta = settleStaleRunMeta(meta);
    }
    const active = meta.status === "running" || meta.status === "stopping";
    return { domainId, meta, active };
  }

  return {
    async list() {
      await requireAccess();
      const domainId = owner.domainId;
      const activeRun = getActiveRun();
      const keptKeys = await getArtifactRetentionSnapshot();
      const runs = listRuns({ activeRunId: activeRun?.runId, domainId })
        .map((run) => ({
          run,
          kept: hasArtifactRetention(keptKeys, "autotest-run", run.runId),
        }))
        .sort((a, b) => {
          const keptDiff = Number(b.kept) - Number(a.kept);
          if (keptDiff !== 0) return keptDiff;
          return (b.run.createdAt || "").localeCompare(a.run.createdAt || "");
        });

      const records = runs.map<PanelRecord>(({ run, kept }) => {
        const active = run.status === "running" || run.status === "stopping";
        const stats = summarizeRun(run, [], locale);
        return {
          className: AUTOTEST_RUN,
          primaryKey: run.runId,
          label: run.caseSetName || run.runId.slice(0, 8),
          subtitle: run.runId,
          fields: {
            runId: run.runId,
            caseSetName: run.caseSetName || run.runId.slice(0, 8),
            status: run.status,
            statusLabel: localizedStatusLabel(run.status, locale),
            active,
            kept,
            keptLabel: kept ? tForLocale(locale, "panels.ops.kept") : "",
            startedAt: run.createdAt ?? "",
            summaryLine: stats.summaryLine,
            total: stats.total,
            accuracyRate: stats.accuracyRate,
          },
          fieldLabels: {
            caseSetName: tForLocale(locale, "panels.ops.fields.caseSet"),
            statusLabel: tForLocale(locale, "panels.ops.fields.status"),
            keptLabel: tForLocale(locale, "panels.ops.fields.retention"),
            startedAt: tForLocale(locale, "panels.ops.fields.startedAt"),
            summaryLine: tForLocale(locale, "panels.ops.fields.summary"),
          },
          tones: {
            statusLabel: statusTone(run.status),
            ...(kept ? { keptLabel: "info" as const } : {}),
          },
        };
      });
      return records.some(record => record.fields.active) ? withReadDirective(records, autotestRunReadDirective) : records;
    },

    async record(runId: string) {
      const { meta, active } = await requireRun(runId);
      const keptKeys = await getArtifactRetentionSnapshot();
      const kept = hasArtifactRetention(keptKeys, "autotest-run", runId);
      const results = loadCaseResults(runId);
      const stats = summarizeRun(meta, results, locale);
      const record: PanelRecord = {
        className: AUTOTEST_RUN,
        primaryKey: meta.runId,
        label: meta.caseSetName || meta.runId,
        subtitle: meta.runId,
        fields: {
          runId: meta.runId,
          caseSetName: meta.caseSetName || meta.runId,
          status: meta.status,
          statusLabel: localizedStatusLabel(meta.status, locale),
          active,
          kept,
          keptLabel: kept ? tForLocale(locale, "panels.ops.kept") : "",
          startedAt: meta.createdAt ?? "",
          finishedAt: meta.completedAt ?? "",
          total: stats.total,
          correct: stats.correct,
          wrong: stats.wrong,
          abnormal: stats.abnormal,
          accuracyRate: stats.accuracyRate,
          avgDuration: stats.avgDuration,
          summaryLine: stats.summaryLine,
        },
        fieldLabels: {
          runId: tForLocale(locale, "panels.ops.fields.runId"),
          statusLabel: tForLocale(locale, "panels.ops.fields.status"),
          keptLabel: tForLocale(locale, "panels.ops.fields.retention"),
          startedAt: tForLocale(locale, "panels.ops.fields.startedAt"),
          summaryLine: tForLocale(locale, "panels.ops.fields.summary"),
        },
        tones: {
          statusLabel: statusTone(meta.status),
          ...(kept ? { keptLabel: "info" as const } : {}),
        },
        outputs: { status: meta.status, active, kept },
      };
      return active ? withReadDirective(record, autotestRunReadDirective) : record;
    },

    async results(runId: string, params: { verdict?: "all" | "correct" | "wrong" | "abnormal" } = {}) {
      const { active } = await requireRun(runId);
      const results = loadCaseResults(runId);
      const filter = params.verdict ?? "all";
      const rows = results
        .map((row) => ({ row, verdict: getCaseVerdict(row) }))
        .filter(({ verdict }) => filter === "all" || verdict === filter);

      const records = rows.map<PanelRecord>(({ row, verdict }) => ({
        className: AUTOTEST_CASE_ARTIFACT,
        primaryKey: encodeAutotestCaseArtifactKey(runId, row.caseId),
        label: row.caseId,
        subtitle: row.question,
        fields: {
          runId,
          caseId: row.caseId,
          question: row.question ?? "",
          status: row.status,
          statusLabel: localizedStatusLabel(row.status, locale),
          verdict,
          verdictLabel: localizedVerdictLabel(verdict, locale),
          reason: getCaseVerdictReason(row),
          durationText: formatDurationText(row.durationMs),
        },
        fieldLabels: {
          caseId: tForLocale(locale, "panels.ops.fields.caseId"),
          question: tForLocale(locale, "panels.ops.fields.question"),
          statusLabel: tForLocale(locale, "panels.ops.fields.executionStatus"),
          verdictLabel: tForLocale(locale, "panels.ops.fields.evalConclusion"),
          reason: tForLocale(locale, "panels.ops.fields.errorReason"),
          durationText: tForLocale(locale, "panels.ops.fields.duration"),
        },
        tones: {
          statusLabel: statusTone(row.status),
          verdictLabel: verdictTone(verdict),
          ...(verdict === "wrong"
            ? { verdict: "danger" as const }
            : verdict === "abnormal"
              ? { verdict: "warning" as const }
              : {}),
        },
      }));
      return active ? withReadDirective(records, autotestRunReadDirective) : records;
    },
  };
}

export function createAutotestRunReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  return autotestRunReads(owner, viewer.locale, () => assertManagement(workbenchManagement.opsRunsRead, owner, viewer));
}

export function createRegisteredAutotestRunReadAdapter(owner: ProductOwner, locale: string | undefined, javaFacts: unknown) {
  return autotestRunReads(owner, locale, () => {
    z.literal(workbenchManagement.opsRunsRead.id).parse(javaFacts);
  });
}

function autotestCaseArtifactReads(owner: ProductOwner, locale: string | undefined, requireAccess: () => Promise<void> | void) {
  async function requireCaseArtifact(primaryKey: string): Promise<{
    runId: string;
    caseId: string;
    artifactDir: string;
    manifest: WorkspaceManifest;
  }> {
    await requireAccess();
    const domainId = owner.domainId;
    const { runId, caseId } = parseAutotestCaseArtifactKey(primaryKey);
    let meta: RunMeta | null;
    try {
      meta = loadRunMeta(runId);
    } catch {
      throw new HttpError(400, "Invalid runId");
    }
    if (!meta || meta.domainId !== domainId) {
      throw new HttpError(404, "Test run not found");
    }
    const artifactDir = resolveCaseArtifactDir(autotestConfig.dataDir, runId, caseId);
    if (!artifactDir) {
      throw new HttpError(404, "Case artifacts not found");
    }
    const manifest = loadManifestAtArtifactDir(artifactDir, "");
    if (!manifest) {
      throw new HttpError(404, "Case manifest not found");
    }
    return { runId, caseId, artifactDir, manifest };
  }

  return {
    async record(primaryKey: string): Promise<PanelRecord> {
      const { runId, caseId, manifest } = await requireCaseArtifact(primaryKey);
      const hasEvidence = Boolean(manifest.evidence);
      const caseResult = loadCaseResults(runId).find((item) => item.caseId === caseId);
      const question = manifest.question?.trim() || caseResult?.question?.trim() || "";
      const verdict = caseResult ? getCaseVerdict(caseResult) : null;
      return {
        className: AUTOTEST_CASE_ARTIFACT,
        primaryKey,
        label: tForLocale(locale, "panels.ops.autotest.caseTitle", { caseId }),
        subtitle: question || tForLocale(locale, "panels.ops.autotest.runBadge", { runId }),
        fields: {
          runId,
          caseId,
          question,
          hasEvidence,
          evidenceHint: hasEvidence
            ? tForLocale(locale, "panels.ops.evidence.referenceHint")
            : tForLocale(locale, "panels.ops.evidence.legacyHint"),
          evidenceJson: manifest.evidence ? JSON.stringify(manifest.evidence, null, 2) : "",
          runCount: manifest.evidence?.runs.length ?? 0,
          gapCount: manifest.evidence?.gaps.length ?? 0,
          ...(verdict ? { verdictLabel: localizedVerdictLabel(verdict, locale) } : {}),
        },
        fieldLabels: {
          runId: tForLocale(locale, "panels.ops.fields.runId"),
          caseId: tForLocale(locale, "panels.ops.fields.caseId"),
          question: tForLocale(locale, "panels.ops.fields.question"),
          evidenceHint: tForLocale(locale, "panels.ops.fields.evidenceNote"),
          ...(verdict ? { verdictLabel: tForLocale(locale, "panels.ops.fields.evalConclusion") } : {}),
        },
        tones: {
          hasEvidence: hasEvidence ? "info" : "warning",
          ...(verdict ? { verdictLabel: verdictTone(verdict) } : {}),
        },
        outputs: { runId, caseId, hasEvidence },
      };
    },

    async evidenceRuns(primaryKey: string): Promise<PanelRecord[]> {
      const { manifest } = await requireCaseArtifact(primaryKey);
      return artifactEvidenceRuns(AUTOTEST_CASE_ARTIFACT, manifest, locale);
    },

    async evidenceGaps(primaryKey: string): Promise<PanelRecord[]> {
      const { manifest } = await requireCaseArtifact(primaryKey);
      return artifactEvidenceGaps(AUTOTEST_CASE_ARTIFACT, manifest, locale);
    },

    async files(primaryKey: string): Promise<PanelRecord[]> {
      const { artifactDir } = await requireCaseArtifact(primaryKey);
      const tree = buildArtifactFileTree(artifactDir);
      return artifactFileRecords(AUTOTEST_CASE_ARTIFACT, tree, locale);
    },

    async file(primaryKey: string, filePath: string): Promise<PanelRecord> {
      const { artifactDir } = await requireCaseArtifact(primaryKey);
      const safePath = assertValidRelativeFilePath(filePath);
      const fullPath = resolveArtifactFilePath(artifactDir, safePath);
      if (!fullPath) throw new HttpError(400, "Invalid file path");
      const preview = await readPhysicalFilePreview(fullPath);
      if (!preview) throw new HttpError(404, "Artifact file not found");
      const name = path.posix.basename(safePath);
      return {
        className: AUTOTEST_CASE_ARTIFACT,
        primaryKey: safePath,
        label: name,
        subtitle: safePath,
        fields: {
          path: safePath,
          name,
          content: formatJsonPreview(preview.content, safePath),
          truncated: preview.truncated,
          size: preview.size,
          loadedBytes: preview.loadedBytes,
        },
        fieldLabels: {
          path: tForLocale(locale, "panels.ops.fields.path"),
          size: tForLocale(locale, "panels.ops.fields.size"),
        },
      };
    },
  };
}

export function createAutotestCaseArtifactReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  return autotestCaseArtifactReads(owner, viewer.locale, () => assertManagement(workbenchManagement.opsRunsRead, owner, viewer));
}

export function createRegisteredAutotestCaseArtifactReadAdapter(owner: ProductOwner, locale: string | undefined, javaFacts: unknown) {
  return autotestCaseArtifactReads(owner, locale, () => {
    z.literal(workbenchManagement.opsRunsRead.id).parse(javaFacts);
  });
}

export const DEFAULT_DSL_QUERY_TEXT = `{
  "problem": "",
  "answer": {
    "steps": []
  }
}`;

function dslQueryReads(locale: string | undefined, requireAccess: () => Promise<void> | void) {
  return {
    async form(params?: { values?: PanelFormValues; changedField?: string | null }): Promise<PanelFormDescription> {
      await requireAccess();
      const dslText = typeof params?.values?.dsl === "string" ? params.values.dsl : DEFAULT_DSL_QUERY_TEXT;
      return {
        values: { dsl: dslText },
        fields: [
          {
            path: "/dsl",
            label: tForLocale(locale, "panels.ops.dsl.fieldLabel"),
            help: tForLocale(locale, "panels.ops.dsl.fieldHelp"),
            control: { kind: "code", language: "json" },
            valueSchema: { type: "string" },
            defaultValue: DEFAULT_DSL_QUERY_TEXT,
            required: true,
            readOnly: false,
          },
        ],
        errors: [],
        save: {
          method: "POST",
          path: "/panel-operations/read",
          bodySchema: {
            type: "object",
            properties: {
              dsl: { type: "string" },
            },
            required: ["dsl"],
          },
        },
      };
    },
  };
}

export function createDslQueryReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  return dslQueryReads(viewer.locale, () => requireDslQueryAccess(workbenchManagement.opsDslRead, owner, viewer));
}

export function createRegisteredDslQueryReadAdapter(_owner: ProductOwner, locale: string | undefined, javaFacts: unknown) {
  return dslQueryReads(locale, () => {
    z.literal(workbenchManagement.opsDslRead.id).parse(javaFacts);
  });
}

export { computeSummary };
