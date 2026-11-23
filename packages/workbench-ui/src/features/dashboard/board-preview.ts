import {
  dashboardAuthoring,
  type DashboardGroup,
  type DashboardReplaceLayout,
} from "@ontomato/contracts/dashboard";
import type { FormFieldRejection } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";

/**
 * In-memory unsaved whole-board preview applied over the currently loaded dashboard.
 * Holds only validated pending edits; saved query results stay on the loaded cards.
 */
export interface BoardPreviewState {
  version: number;
  boardName?: string;
  groupRenames: Record<string, string>;
  chartRenames: Record<string, string>;
  metricRenames: Record<string, string>;
  layoutGroups?: DashboardReplaceLayout["groups"];
}

export interface BoardSavePlan {
  renameBoard?: string;
  layoutGroups?: DashboardReplaceLayout["groups"];
  groupRenames: Array<{ groupId: string; dimensionName: string }>;
  chartRenames: Array<{ chartId: string; resultSetName: string }>;
  metricRenames: Array<{ metricId: string; metricName: string }>;
}

export interface BoardPreviewSummary {
  /** Human-readable preview description for the on-page banner (may include preview names). */
  displaySummary: string;
  /**
   * Privacy-safe impact summary for conversation confirmation prompts:
   * names only affected saved objects and field kinds, never edited field values.
   */
  confirmImpactSummary: string;
}

export type ParseBoardPreviewResult =
  | {
      ok: true;
      preview: BoardPreviewState;
      filledFields: string[];
      rejectedFields?: FormFieldRejection[];
    }
  | {
      ok: false;
      reason: "all_fields_rejected";
      member: "board";
      rejectedFields: FormFieldRejection[];
      message: string;
    };

type RuntimeGroup = DashboardGroup & {
  charts: Array<DashboardGroup["charts"][number] & Record<string, unknown>>;
  metrics: Array<DashboardGroup["metrics"][number] & Record<string, unknown>>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTopKey(rawKey: string): string {
  return rawKey.startsWith("/") ? rawKey.slice(1) : rawKey;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function buildBoardIndex(groups: readonly RuntimeGroup[]) {
  const groupMap = new Map<string, RuntimeGroup>();
  const chartMap = new Map<string, RuntimeGroup["charts"][number]>();
  const metricMap = new Map<string, RuntimeGroup["metrics"][number]>();
  for (const group of groups) {
    groupMap.set(group.id, group);
    for (const chart of group.charts ?? []) chartMap.set(chart.id, chart);
    for (const metric of group.metrics ?? []) metricMap.set(metric.id, metric);
  }
  return { groupMap, chartMap, metricMap };
}

function validateLayoutGroups(
  dashboardId: string,
  rawGroups: unknown,
  index: ReturnType<typeof buildBoardIndex>,
): { ok: true; groups: DashboardReplaceLayout["groups"] } | { ok: false; rejections: FormFieldRejection[] } {
  const parsed = dashboardAuthoring["dashboard.layout"].schema.safeParse({
    id: dashboardId,
    groups: rawGroups,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first ? `${first.path.join(".")}: ${first.message}` : "Invalid dashboard layout groups.";
    return {
      ok: false,
      rejections: [{ path: "groups", reason: "invalid_value", message: detail }],
    };
  }

  const rejections: FormFieldRejection[] = [];
  const seenGroups = new Set<string>();
  const seenCharts = new Set<string>();
  const seenMetrics = new Set<string>();

  for (let gi = 0; gi < parsed.data.groups.length; gi += 1) {
    const group = parsed.data.groups[gi]!;
    if (!index.groupMap.has(group.id)) {
      rejections.push({
        path: `groups.${gi}.id`,
        reason: "unknown_field",
        message: `Group '${group.id}' does not belong to dashboard '${dashboardId}'.`,
      });
    } else if (seenGroups.has(group.id)) {
      rejections.push({
        path: `groups.${gi}.id`,
        reason: "invalid_value",
        message: `Duplicate group '${group.id}' in layout.`,
      });
    } else {
      seenGroups.add(group.id);
    }

    for (let ci = 0; ci < group.charts.length; ci += 1) {
      const chart = group.charts[ci]!;
      if (!index.chartMap.has(chart.id)) {
        rejections.push({
          path: `groups.${gi}.charts.${ci}.id`,
          reason: "unknown_field",
          message: `Chart '${chart.id}' does not belong to dashboard '${dashboardId}'.`,
        });
      } else if (seenCharts.has(chart.id)) {
        rejections.push({
          path: `groups.${gi}.charts.${ci}.id`,
          reason: "invalid_value",
          message: `Duplicate chart '${chart.id}' in layout.`,
        });
      } else {
        seenCharts.add(chart.id);
      }
    }

    for (let mi = 0; mi < group.metrics.length; mi += 1) {
      const metric = group.metrics[mi]!;
      if (!index.metricMap.has(metric.id)) {
        rejections.push({
          path: `groups.${gi}.metrics.${mi}.id`,
          reason: "unknown_field",
          message: `Metric '${metric.id}' does not belong to dashboard '${dashboardId}'.`,
        });
      } else if (seenMetrics.has(metric.id)) {
        rejections.push({
          path: `groups.${gi}.metrics.${mi}.id`,
          reason: "invalid_value",
          message: `Duplicate metric '${metric.id}' in layout.`,
        });
      } else {
        seenMetrics.add(metric.id);
      }
    }
  }

  if (rejections.length > 0) return { ok: false, rejections };
  return { ok: true, groups: parsed.data.groups };
}

function parseOperationShape(
  dashboardId: string,
  normalized: Record<string, unknown>,
  index: ReturnType<typeof buildBoardIndex>,
  nextVersion: number,
): ParseBoardPreviewResult {
  const operation = normalized.operation;
  const { operation: _op, ...body } = normalized;
  if (body.id !== undefined && String(body.id) !== dashboardId) {
    return {
      ok: false,
      reason: "all_fields_rejected",
      member: "board",
      rejectedFields: [{
        path: "id",
        reason: "invalid_value",
        message: `Dashboard id '${String(body.id)}' does not match open dashboard '${dashboardId}'.`,
      }],
      message: "Dashboard id does not match the currently open dashboard.",
    };
  }
  const withId = { ...body, id: dashboardId };
  const basePreview: BoardPreviewState = {
    version: nextVersion,
    groupRenames: {},
    chartRenames: {},
    metricRenames: {},
  };

  if (operation === "dashboard.rename") {
    const parsed = dashboardAuthoring["dashboard.rename"].schema.safeParse(withId);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{ path: "name", reason: "invalid_value", message: parsed.error.issues[0]?.message ?? "Invalid dashboard name." }],
        message: "Invalid dashboard.rename payload.",
      };
    }
    return {
      ok: true,
      preview: { ...basePreview, boardName: parsed.data.name },
      filledFields: ["name"],
    };
  }

  if (operation === "dashboard.group.rename") {
    const parsed = dashboardAuthoring["dashboard.group.rename"].schema.safeParse(withId);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{ path: "dimensionName", reason: "invalid_value", message: parsed.error.issues[0]?.message ?? "Invalid group rename." }],
        message: "Invalid dashboard.group.rename payload.",
      };
    }
    if (!index.groupMap.has(parsed.data.groupId)) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{
          path: "groupId",
          reason: "unknown_field",
          message: `Group '${parsed.data.groupId}' does not belong to dashboard '${dashboardId}'.`,
        }],
        message: `Group '${parsed.data.groupId}' does not belong to the open dashboard.`,
      };
    }
    return {
      ok: true,
      preview: { ...basePreview, groupRenames: { [parsed.data.groupId]: parsed.data.dimensionName } },
      filledFields: [`groupNames.${parsed.data.groupId}`],
    };
  }

  if (operation === "dashboard.chart.rename") {
    const parsed = dashboardAuthoring["dashboard.chart.rename"].schema.safeParse(withId);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{ path: "resultSetName", reason: "invalid_value", message: parsed.error.issues[0]?.message ?? "Invalid chart rename." }],
        message: "Invalid dashboard.chart.rename payload.",
      };
    }
    if (!index.chartMap.has(parsed.data.chartId)) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{
          path: "chartId",
          reason: "unknown_field",
          message: `Chart '${parsed.data.chartId}' does not belong to dashboard '${dashboardId}'.`,
        }],
        message: `Chart '${parsed.data.chartId}' does not belong to the open dashboard.`,
      };
    }
    return {
      ok: true,
      preview: { ...basePreview, chartRenames: { [parsed.data.chartId]: parsed.data.resultSetName } },
      filledFields: [`cardNames.${parsed.data.chartId}`],
    };
  }

  if (operation === "dashboard.metric.rename") {
    const parsed = dashboardAuthoring["dashboard.metric.rename"].schema.safeParse(withId);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{ path: "metricName", reason: "invalid_value", message: parsed.error.issues[0]?.message ?? "Invalid metric rename." }],
        message: "Invalid dashboard.metric.rename payload.",
      };
    }
    if (!index.metricMap.has(parsed.data.metricId)) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: [{
          path: "metricId",
          reason: "unknown_field",
          message: `Metric '${parsed.data.metricId}' does not belong to dashboard '${dashboardId}'.`,
        }],
        message: `Metric '${parsed.data.metricId}' does not belong to the open dashboard.`,
      };
    }
    return {
      ok: true,
      preview: { ...basePreview, metricRenames: { [parsed.data.metricId]: parsed.data.metricName } },
      filledFields: [`cardNames.${parsed.data.metricId}`],
    };
  }

  if (operation === "dashboard.layout") {
    const extraKeys = Object.keys(body).filter((key) => key !== "id" && key !== "groups");
    if (extraKeys.length > 0) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: extraKeys.map((key) => ({
          path: key,
          reason: "unknown_field" as const,
          message: `Unexpected field '${key}' for dashboard.layout.`,
        })),
        message: "Unexpected fields in dashboard.layout payload.",
      };
    }
    const checked = validateLayoutGroups(dashboardId, body.groups, index);
    if (!checked.ok) {
      return {
        ok: false,
        reason: "all_fields_rejected",
        member: "board",
        rejectedFields: checked.rejections,
        message: checked.rejections[0]?.message ?? "Invalid dashboard layout.",
      };
    }
    return {
      ok: true,
      preview: { ...basePreview, layoutGroups: checked.groups },
      filledFields: ["groups"],
    };
  }

  const hint = operation === "dashboard.card.parameters"
    ? "Use member 'card.parameters' to fill card parameter values."
    : `Unsupported dashboard operation '${String(operation)}'.`;
  return {
    ok: false,
    reason: "all_fields_rejected",
    member: "board",
    rejectedFields: [{ path: "operation", reason: "invalid_value", message: hint }],
    message: hint,
  };
}

/**
 * Validates and converts `fill_form({ member: "board", values })` input into an unsaved
 * whole-board preview state against the currently open dashboard.
 */
export function parseBoardPreviewFill(
  dashboardId: string,
  savedGroups: readonly RuntimeGroup[],
  rawValues: Readonly<Record<string, RuntimeJsonValue>>,
  nextVersion: number,
): ParseBoardPreviewResult {
  const index = buildBoardIndex(savedGroups);
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(rawValues)) {
    normalized[normalizeTopKey(rawKey)] = value;
  }

  if ("operation" in normalized) {
    return parseOperationShape(dashboardId, normalized, index, nextVersion);
  }

  const preview: BoardPreviewState = {
    version: nextVersion,
    groupRenames: {},
    chartRenames: {},
    metricRenames: {},
  };
  const filledFields: string[] = [];
  const rejectedFields: FormFieldRejection[] = [];

  for (const [key, value] of Object.entries(normalized)) {
    if (key === "name" || key === "boardName") {
      const parsed = dashboardAuthoring["dashboard.rename"].schema.safeParse({
        id: dashboardId,
        name: value,
      });
      if (!parsed.success) {
        rejectedFields.push({
          path: key,
          reason: "invalid_value",
          message: parsed.error.issues[0]?.message ?? "Dashboard name must be a non-empty string.",
        });
        continue;
      }
      if (preview.boardName !== undefined && preview.boardName !== parsed.data.name) {
        rejectedFields.push({
          path: key,
          reason: "invalid_value",
          message: "Conflicting values provided for 'name' and 'boardName'.",
        });
        continue;
      }
      preview.boardName = parsed.data.name;
      filledFields.push(key);
      continue;
    }

    if (key === "groupNames") {
      if (!isPlainRecord(value) || Object.keys(value).length === 0) {
        rejectedFields.push({
          path: "groupNames",
          reason: "invalid_value",
          message: "groupNames must be a non-empty object mapping groupId to title.",
        });
        continue;
      }
      for (const [groupId, nextTitle] of Object.entries(value)) {
        if (!index.groupMap.has(groupId)) {
          rejectedFields.push({
            path: `groupNames.${groupId}`,
            reason: "unknown_field",
            message: `Group '${groupId}' does not belong to dashboard '${dashboardId}'.`,
          });
          continue;
        }
        const parsed = dashboardAuthoring["dashboard.group.rename"].schema.safeParse({
          id: dashboardId,
          groupId,
          dimensionName: nextTitle,
        });
        if (!parsed.success) {
          rejectedFields.push({
            path: `groupNames.${groupId}`,
            reason: "invalid_value",
            message: parsed.error.issues[0]?.message ?? "Group title must be a string.",
          });
          continue;
        }
        preview.groupRenames[groupId] = parsed.data.dimensionName;
        filledFields.push(`groupNames.${groupId}`);
      }
      continue;
    }

    if (key === "cardNames") {
      if (!isPlainRecord(value) || Object.keys(value).length === 0) {
        rejectedFields.push({
          path: "cardNames",
          reason: "invalid_value",
          message: "cardNames must be a non-empty object mapping cardId to name.",
        });
        continue;
      }
      for (const [cardId, nextName] of Object.entries(value)) {
        const isChart = index.chartMap.has(cardId);
        const isMetric = index.metricMap.has(cardId);
        if (!isChart && !isMetric) {
          rejectedFields.push({
            path: `cardNames.${cardId}`,
            reason: "unknown_field",
            message: `Card '${cardId}' does not belong to dashboard '${dashboardId}'.`,
          });
          continue;
        }
        if (isChart) {
          const parsed = dashboardAuthoring["dashboard.chart.rename"].schema.safeParse({
            id: dashboardId,
            chartId: cardId,
            resultSetName: nextName,
          });
          if (!parsed.success) {
            rejectedFields.push({
              path: `cardNames.${cardId}`,
              reason: "invalid_value",
              message: parsed.error.issues[0]?.message ?? "Card name must be a non-empty string.",
            });
            continue;
          }
          preview.chartRenames[cardId] = parsed.data.resultSetName;
          filledFields.push(`cardNames.${cardId}`);
        } else {
          const parsed = dashboardAuthoring["dashboard.metric.rename"].schema.safeParse({
            id: dashboardId,
            metricId: cardId,
            metricName: nextName,
          });
          if (!parsed.success) {
            rejectedFields.push({
              path: `cardNames.${cardId}`,
              reason: "invalid_value",
              message: parsed.error.issues[0]?.message ?? "Card name must be a non-empty string.",
            });
            continue;
          }
          preview.metricRenames[cardId] = parsed.data.metricName;
          filledFields.push(`cardNames.${cardId}`);
        }
      }
      continue;
    }

    if (key === "groups") {
      const checked = validateLayoutGroups(dashboardId, value, index);
      if (!checked.ok) {
        rejectedFields.push(...checked.rejections);
        continue;
      }
      preview.layoutGroups = checked.groups;
      filledFields.push("groups");
      continue;
    }

    rejectedFields.push({
      path: key,
      reason: "unknown_field",
      message: `Field '${key}' is not supported on the dashboard board form.`,
    });
  }

  if (filledFields.length === 0) {
    return {
      ok: false,
      reason: "all_fields_rejected",
      member: "board",
      rejectedFields,
      message: rejectedFields[0]?.message ?? "None of the supplied dashboard fields could be applied.",
    };
  }

  return {
    ok: true,
    preview,
    filledFields,
    ...(rejectedFields.length > 0 ? { rejectedFields } : {}),
  };
}

/**
 * Overlays an unsaved preview on top of currently loaded dashboard groups while preserving
 * each card's live queried rows, columns, truncation, and load state.
 */
export function applyBoardPreviewOverlay(
  savedGroups: readonly RuntimeGroup[],
  preview: BoardPreviewState | null,
): RuntimeGroup[] {
  if (!preview) return savedGroups as RuntimeGroup[];
  const index = buildBoardIndex(savedGroups);

  if (preview.layoutGroups) {
    const result: RuntimeGroup[] = [];
    for (const entry of preview.layoutGroups) {
      const savedGroup = index.groupMap.get(entry.id);
      if (!savedGroup) continue;
      const title = preview.groupRenames[entry.id] ?? entry.title;
      const charts: RuntimeGroup["charts"] = [];
      for (const patch of entry.charts) {
        const savedCard = index.chartMap.get(patch.id);
        if (!savedCard) continue;
        const nextName = preview.chartRenames[patch.id] ?? patch.name ?? savedCard.name;
        charts.push({
          ...savedCard,
          name: nextName,
          title: nextName,
          layout: patch.layout ?? savedCard.layout,
          chartFile: patch.chartFile ?? savedCard.chartFile,
        });
      }
      const metrics: RuntimeGroup["metrics"] = [];
      for (const patch of entry.metrics) {
        const savedCard = index.metricMap.get(patch.id);
        if (!savedCard) continue;
        const nextName = preview.metricRenames[patch.id] ?? patch.name ?? savedCard.name;
        metrics.push({
          ...savedCard,
          ...patch,
          name: nextName,
          layout: patch.layout ?? savedCard.layout,
        });
      }
      result.push({ ...savedGroup, title, charts, metrics });
    }
    return result;
  }

  return savedGroups.map((group) => ({
    ...group,
    title: preview.groupRenames[group.id] ?? group.title,
    charts: (group.charts ?? []).map((card) => {
      const nextName = preview.chartRenames[card.id];
      return nextName !== undefined ? { ...card, name: nextName, title: nextName } : card;
    }),
    metrics: (group.metrics ?? []).map((card) => {
      const nextName = preview.metricRenames[card.id];
      return nextName !== undefined ? { ...card, name: nextName } : card;
    }),
  }));
}

/** Identifies cards visually modified by the active unsaved preview. */
export function boardPreviewModifiedCards(
  savedGroups: readonly RuntimeGroup[],
  preview: BoardPreviewState | null,
): Set<string> {
  const modified = new Set<string>();
  if (!preview) return modified;
  const index = buildBoardIndex(savedGroups);

  for (const [chartId, nextName] of Object.entries(preview.chartRenames)) {
    const saved = index.chartMap.get(chartId);
    if (saved && saved.name !== nextName) modified.add(chartId);
  }
  for (const [metricId, nextName] of Object.entries(preview.metricRenames)) {
    const saved = index.metricMap.get(metricId);
    if (saved && saved.name !== nextName) modified.add(metricId);
  }

  if (preview.layoutGroups) {
    for (const entry of preview.layoutGroups) {
      for (const patch of entry.charts) {
        const saved = index.chartMap.get(patch.id);
        if (!saved) continue;
        const nameChanged = patch.name !== undefined && patch.name !== saved.name;
        const chartChanged = patch.chartFile !== undefined && !sameJson(patch.chartFile.content, saved.chartFile.content);
        const layoutChanged = patch.layout !== undefined && (
          patch.layout.colSpan !== saved.layout?.colSpan || patch.layout.rowSpan !== saved.layout?.rowSpan
        );
        if (nameChanged || chartChanged || layoutChanged) modified.add(patch.id);
      }
      for (const patch of entry.metrics) {
        const saved = index.metricMap.get(patch.id);
        if (!saved) continue;
        const nameChanged = patch.name !== undefined && patch.name !== saved.name;
        const layoutChanged = patch.layout !== undefined && (
          patch.layout.colSpan !== saved.layout?.colSpan || patch.layout.rowSpan !== saved.layout?.rowSpan
        );
        if (nameChanged || layoutChanged) modified.add(patch.id);
      }
    }
  }
  return modified;
}

/**
 * Produces both the on-page preview banner summary and the privacy-safe confirmation
 * impact summary (which lists only affected saved object/field names, never edited values).
 */
export function summarizeBoardPreview(
  savedBoardName: string,
  savedGroups: readonly RuntimeGroup[],
  preview: BoardPreviewState,
): BoardPreviewSummary {
  const index = buildBoardIndex(savedGroups);
  const displayParts: string[] = [];
  const confirmParts: string[] = [];

  if (preview.boardName !== undefined && preview.boardName !== savedBoardName) {
    displayParts.push(`${savedBoardName || "Dashboard"} → ${preview.boardName}`);
    confirmParts.push("Dashboard name");
  }

  const groupChanges: string[] = [];
  const groupConfirm: string[] = [];
  const chartChanges: string[] = [];
  const chartConfirm: string[] = [];
  const metricChanges: string[] = [];
  const metricConfirm: string[] = [];
  let layoutOrderChanged = false;

  if (preview.layoutGroups) {
    const savedOrder = savedGroups.map((g) => `${g.id}:${(g.charts ?? []).map((c) => c.id).join(",")}|${(g.metrics ?? []).map((m) => m.id).join(",")}`);
    const nextOrder = preview.layoutGroups.map((g) => `${g.id}:${g.charts.map((c) => c.id).join(",")}|${g.metrics.map((m) => m.id).join(",")}`);
    layoutOrderChanged = !sameJson(savedOrder, nextOrder);

    for (const entry of preview.layoutGroups) {
      const savedGroup = index.groupMap.get(entry.id);
      if (!savedGroup) continue;
      const nextTitle = preview.groupRenames[entry.id] ?? entry.title;
      if (nextTitle !== savedGroup.title) {
        groupChanges.push(`${savedGroup.title || entry.id} → ${nextTitle}`);
        groupConfirm.push(`${savedGroup.title || entry.id} (title)`);
      }
      for (const patch of entry.charts) {
        const saved = index.chartMap.get(patch.id);
        if (!saved) continue;
        const fields: string[] = [];
        const nextName = preview.chartRenames[patch.id] ?? patch.name;
        if (nextName !== undefined && nextName !== saved.name) fields.push("name");
        if (patch.chartFile && !sameJson(patch.chartFile.content, saved.chartFile.content)) fields.push("chart");
        if (patch.layout && (patch.layout.colSpan !== saved.layout?.colSpan || patch.layout.rowSpan !== saved.layout?.rowSpan)) fields.push("layout");
        if (fields.length > 0) {
          chartChanges.push(nextName && nextName !== saved.name ? `${saved.name} → ${nextName}` : `${saved.name} (${fields.join(", ")})`);
          chartConfirm.push(`${saved.name} (${fields.join(", ")})`);
        }
      }
      for (const patch of entry.metrics) {
        const saved = index.metricMap.get(patch.id);
        if (!saved) continue;
        const fields: string[] = [];
        const nextName = preview.metricRenames[patch.id] ?? patch.name;
        if (nextName !== undefined && nextName !== saved.name) fields.push("name");
        if (patch.layout && (patch.layout.colSpan !== saved.layout?.colSpan || patch.layout.rowSpan !== saved.layout?.rowSpan)) fields.push("layout");
        if (fields.length > 0) {
          metricChanges.push(nextName && nextName !== saved.name ? `${saved.name} → ${nextName}` : `${saved.name} (${fields.join(", ")})`);
          metricConfirm.push(`${saved.name} (${fields.join(", ")})`);
        }
      }
    }
  } else {
    for (const [groupId, nextTitle] of Object.entries(preview.groupRenames)) {
      const saved = index.groupMap.get(groupId);
      if (saved && saved.title !== nextTitle) {
        groupChanges.push(`${saved.title || groupId} → ${nextTitle}`);
        groupConfirm.push(`${saved.title || groupId} (title)`);
      }
    }
    for (const [chartId, nextName] of Object.entries(preview.chartRenames)) {
      const saved = index.chartMap.get(chartId);
      if (saved && saved.name !== nextName) {
        chartChanges.push(`${saved.name} → ${nextName}`);
        chartConfirm.push(`${saved.name} (name)`);
      }
    }
    for (const [metricId, nextName] of Object.entries(preview.metricRenames)) {
      const saved = index.metricMap.get(metricId);
      if (saved && saved.name !== nextName) {
        metricChanges.push(`${saved.name} → ${nextName}`);
        metricConfirm.push(`${saved.name} (name)`);
      }
    }
  }

  if (groupChanges.length > 0) displayParts.push(groupChanges.join(", "));
  if (chartChanges.length > 0) displayParts.push(chartChanges.join(", "));
  if (metricChanges.length > 0) displayParts.push(metricChanges.join(", "));
  if (layoutOrderChanged) displayParts.push("layout");

  if (groupConfirm.length > 0) confirmParts.push(`Groups: ${groupConfirm.join(", ")}`);
  if (chartConfirm.length > 0) confirmParts.push(`Charts: ${chartConfirm.join(", ")}`);
  if (metricConfirm.length > 0) confirmParts.push(`Metrics: ${metricConfirm.join(", ")}`);
  if (layoutOrderChanged) confirmParts.push("Layout order");

  return {
    displaySummary: displayParts.join(" · ") || savedBoardName,
    confirmImpactSummary: confirmParts.join("; ") || "Dashboard layout",
  };
}

/** Builds the concrete API call plan for saving the current board preview. */
export function buildBoardSavePlan(
  savedBoardName: string,
  preview: BoardPreviewState,
): BoardSavePlan {
  const plan: BoardSavePlan = {
    groupRenames: [],
    chartRenames: [],
    metricRenames: [],
  };

  if (preview.boardName !== undefined && preview.boardName !== savedBoardName) {
    plan.renameBoard = preview.boardName;
  }

  if (preview.layoutGroups) {
    plan.layoutGroups = preview.layoutGroups.map((group) => ({
      ...group,
      title: preview.groupRenames[group.id] ?? group.title,
      charts: group.charts.map((chart) => {
        const renamed = preview.chartRenames[chart.id];
        return renamed !== undefined ? { ...chart, name: renamed } : chart;
      }),
      metrics: group.metrics.map((metric) => {
        const renamed = preview.metricRenames[metric.id];
        return renamed !== undefined ? { ...metric, name: renamed } : metric;
      }),
    }));
  } else {
    for (const [groupId, dimensionName] of Object.entries(preview.groupRenames)) {
      plan.groupRenames.push({ groupId, dimensionName });
    }
    for (const [chartId, resultSetName] of Object.entries(preview.chartRenames)) {
      plan.chartRenames.push({ chartId, resultSetName });
    }
    for (const [metricId, metricName] of Object.entries(preview.metricRenames)) {
      plan.metricRenames.push({ metricId, metricName });
    }
  }

  return plan;
}

/** Stable canonical snapshot of a board preview for stale-confirmation checks. */
export function canonicalBoardPreviewSnapshot(preview: BoardPreviewState): string {
  return canonicalJson({
    boardName: preview.boardName ?? null,
    groupRenames: preview.groupRenames,
    chartRenames: preview.chartRenames,
    metricRenames: preview.metricRenames,
    layoutGroups: preview.layoutGroups ?? null,
  });
}
