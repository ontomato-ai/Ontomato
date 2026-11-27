import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  dashboardCardPrimaryKey,
  dashboardMetricDescriptionSchema,
  dashboardParameterFormSchema,
  parseDashboardCardPrimaryKey,
  type DashboardDetail,
  type DashboardGroup,
  type DashboardMetricDescription,
  type DashboardParameterForm,
  type MetricReferenceEntry,
} from "@ontomato/contracts/dashboard";
import { formFieldPointer } from "@ontomato/contracts/form-fields";
import {
  panelReadParameterSchemas,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
  type PanelRecord,
  type PanelRecordFieldValue,
} from "@ontomato/contracts/panel-projection";
import { DASHBOARD, DASHBOARD_CARD, METRIC_VIEW } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import type { ProductOwner } from "../product-governance/service-authentication";
import { favoriteTargetKey, readFavoriteKeySet } from "../platform-home/service";
import type { JavaPanelRead } from "../product-panels/java-panel-reads";
import { localReadRegistration, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { getOwnedDashboard } from "./access";
import { DashboardMetricClient } from "./metric-client";
import { metricCardParameterForm, ownedCard } from "./metric-data";
import { listDashboards } from "./store";

type FormReadParams = {
  values?: PanelFormValues;
  changedField?: string | null;
};

function findCardWithGroup(
  detail: DashboardDetail,
  cardId: string,
): { group: DashboardGroup; groupIndex: number; card: MetricReferenceEntry; kind: "chart" | "metric" } | null {
  for (let groupIndex = 0; groupIndex < detail.groups.length; groupIndex += 1) {
    const group = detail.groups[groupIndex]!;
    const metric = group.metrics.find(entry => entry.id === cardId);
    if (metric) return { group, groupIndex, card: metric, kind: "metric" };
    const chart = group.charts.find(entry => entry.id === cardId);
    if (chart) return { group, groupIndex, card: chart, kind: "chart" };
  }
  return null;
}

function metricStatusTone(status: string | undefined): "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "PUBLISHED":
      return "success";
    case "PENDING_REVIEW":
      return "warning";
    case "UNAVAILABLE":
      return "danger";
    default:
      return "default";
  }
}

function metricStatusLabel(status: string | undefined, locale?: string): string {
  switch (status) {
    case "PUBLISHED":
      return tForLocale(locale, "panels.dashboard.metricStatus.published");
    case "PENDING_REVIEW":
      return tForLocale(locale, "panels.dashboard.metricStatus.pendingReview");
    case "UNUSED":
      return tForLocale(locale, "panels.dashboard.metricStatus.unused");
    case "UNAVAILABLE":
      return tForLocale(locale, "panels.dashboard.metricStatus.unavailable");
    default:
      return status || "—";
  }
}

function dashboardCardRecord(
  detail: DashboardDetail,
  group: DashboardGroup,
  groupIndex: number,
  card: MetricReferenceEntry,
  order: number,
  locale?: string,
  favorited = false,
): PanelRecord {
  const isChart = "chartFile" in card;
  const colSpan = card.layout?.colSpan ?? (isChart ? 12 : 3);
  const rowSpan = card.layout?.rowSpan ?? 1;
  const primaryKey = dashboardCardPrimaryKey({ dashboardId: detail.id, cardId: card.id });
  const openPath = `/dashboards?dashboardId=${encodeURIComponent(detail.id)}&cardId=${encodeURIComponent(card.id)}`;
  const fields: Record<string, PanelRecordFieldValue> = {
    cardId: card.id,
    dashboardId: detail.id,
    name: card.name,
    kind: isChart ? "chart" : "metric",
    groupId: group.id,
    groupTitle: group.title,
    groupIndex,
    order,
    colSpan,
    rowSpan,
    metricId: card.query.metricId,
    hasParameters: Object.keys(card.query.parameters).length > 0,
    favorite: favorited,
  };
  if (isChart) {
    const firstSeries = card.chartFile.content.series[0] as { type?: unknown } | undefined;
    const chartType = typeof firstSeries?.type === "string" && firstSeries.type.length > 0 ? firstSeries.type : undefined;
    if (chartType) fields.chartType = chartType;
    fields.chartFile = { kind: "json", value: card.chartFile };
  } else {
    fields.valueField = card.valueField;
    if (card.unit !== undefined && card.unit.length > 0) fields.unit = card.unit;
    if (card.formats !== undefined) fields.formats = { kind: "json", value: card.formats };
    if (card.sort !== undefined) fields.sort = { kind: "json", value: card.sort };
  }
  return {
    primaryKey,
    className: DASHBOARD_CARD,
    label: card.name,
    fields,
    fieldLabels: {
      name: tForLocale(locale, "panels.dashboard.fields.cardName"),
      kind: tForLocale(locale, "panels.dashboard.fields.cardKind"),
      groupTitle: tForLocale(locale, "panels.dashboard.fields.groupTitle"),
      colSpan: tForLocale(locale, "panels.dashboard.fields.colSpan"),
      rowSpan: tForLocale(locale, "panels.dashboard.fields.rowSpan"),
    },
    outputs: {
      name: card.name,
      kind: isChart ? "chart" : "metric",
      metricId: card.query.metricId,
      openPath,
      favorited,
    },
  };
}

export function createDashboardReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const { userId, domainId } = owner;
  const { locale } = viewer;

  return {
    async list(): Promise<PanelRecord[]> {
      const [items, favoriteKeys] = await Promise.all([
        listDashboards(userId, domainId),
        readFavoriteKeySet(owner),
      ]);
      const fieldLabels = {
        name: tForLocale(locale, "panels.dashboard.fields.name"),
        createdAt: tForLocale(locale, "panels.dashboard.fields.createdAt"),
        updatedAt: tForLocale(locale, "panels.dashboard.fields.updatedAt"),
      };
      return items.map(item => {
        const favorited = favoriteKeys.has(favoriteTargetKey(DASHBOARD, item.id));
        const openPath = `/dashboards?dashboardId=${encodeURIComponent(item.id)}`;
        return {
          primaryKey: item.id,
          className: DASHBOARD,
          label: item.name,
          fields: {
            name: item.name,
            createdAt: new Date(item.createdAt).toISOString(),
            updatedAt: new Date(item.updatedAt).toISOString(),
            favorite: favorited,
          },
          fieldLabels,
          outputs: {
            openPath,
            favorited,
          },
        };
      });
    },

    async record(dashboardId: string): Promise<PanelRecord> {
      const [detail, favoriteKeys] = await Promise.all([
        getOwnedDashboard(userId, domainId, dashboardId),
        readFavoriteKeySet(owner),
      ]);
      const groupCount = detail.groups.length;
      const cardCount = detail.groups.reduce((count, group) => count + group.charts.length + group.metrics.length, 0);
      const favorited = favoriteKeys.has(favoriteTargetKey(DASHBOARD, detail.id));
      const openPath = `/dashboards?dashboardId=${encodeURIComponent(detail.id)}`;
      return {
        primaryKey: detail.id,
        className: DASHBOARD,
        label: detail.name,
        fields: {
          name: detail.name,
          createdAt: new Date(detail.createdAt).toISOString(),
          updatedAt: new Date(detail.updatedAt).toISOString(),
          groupCount,
          cardCount,
          favorite: favorited,
          groups: {
            kind: "json",
            value: detail.groups.map((group, order) => ({
              id: group.id,
              title: group.title,
              order,
              metricCount: group.metrics.length,
              chartCount: group.charts.length,
            })),
          },
        },
        fieldLabels: {
          name: tForLocale(locale, "panels.dashboard.fields.name"),
          createdAt: tForLocale(locale, "panels.dashboard.fields.createdAt"),
          updatedAt: tForLocale(locale, "panels.dashboard.fields.updatedAt"),
          groupCount: tForLocale(locale, "panels.dashboard.fields.groupCount"),
          cardCount: tForLocale(locale, "panels.dashboard.fields.cardCount"),
        },
        outputs: {
          name: detail.name,
          groupCount,
          cardCount,
          openPath,
          favorited,
        },
      };
    },

    async cards(dashboardId: string): Promise<PanelRecord[]> {
      const [detail, favoriteKeys] = await Promise.all([
        getOwnedDashboard(userId, domainId, dashboardId),
        readFavoriteKeySet(owner),
      ]);
      const rows: PanelRecord[] = [];
      detail.groups.forEach((group, groupIndex) => {
        group.metrics.forEach((card, order) => {
          const favorited = favoriteKeys.has(favoriteTargetKey(DASHBOARD_CARD, dashboardCardPrimaryKey({ dashboardId: detail.id, cardId: card.id })));
          rows.push(dashboardCardRecord(detail, group, groupIndex, card, order, locale, favorited));
        });
        group.charts.forEach((card, order) => {
          const favorited = favoriteKeys.has(favoriteTargetKey(DASHBOARD_CARD, dashboardCardPrimaryKey({ dashboardId: detail.id, cardId: card.id })));
          rows.push(dashboardCardRecord(detail, group, groupIndex, card, order, locale, favorited));
        });
      });
      return rows;
    },
  };
}

function presentCardParameterForm(loaded: DashboardParameterForm, overrides?: PanelFormValues): PanelFormDescription {
  const readOnlySet = new Set(loaded.readOnly);
  const fields: PanelFormField[] = loaded.fields.map(field => {
    const path = formFieldPointer("/", field.key);
    const base = {
      path,
      label: field.label,
      required: field.required,
      readOnly: readOnlySet.has(field.key),
      ...(field.help !== null ? { help: field.help } : {}),
      ...(field.defaultValue !== null ? { defaultValue: field.defaultValue } : {}),
    };
    if (field.type === "select") {
      const enumValues = field.options.map(option => option.value);
      const valueSchema: Record<string, RuntimeJsonValue> = enumValues.length > 0
        ? { type: "string", enum: enumValues }
        : { type: "string" };
      return {
        ...base,
        valueSchema,
        ...(field.refreshOnChange ? { refreshOnChange: true } : {}),
        control: {
          kind: "select",
          options: field.options.map(option => ({
            value: option.value,
            label: option.label,
            description: option.description,
            disabled: option.disabled,
            disabledReason: option.disabledReason,
          })),
        },
      };
    }
    const valueSchema: Record<string, RuntimeJsonValue> = { type: "string", maxLength: field.maxLength };
    return {
      ...base,
      valueSchema,
      control: {
        kind: "text",
        multiline: field.multiline,
        ...(field.placeholder !== null ? { placeholder: field.placeholder } : {}),
        maxLength: field.maxLength,
      },
    };
  });

  const values: PanelFormValues = {};
  for (const field of loaded.fields) {
    const incoming = overrides?.[field.key];
    if (!readOnlySet.has(field.key) && typeof incoming === "string") {
      values[field.key] = incoming;
    } else if (typeof loaded.values[field.key] === "string") {
      values[field.key] = loaded.values[field.key]!;
    } else {
      values[field.key] = "";
    }
  }

  const properties: Record<string, { type: string }> = {};
  for (const field of loaded.fields) properties[field.key] = { type: "string" };

  return {
    fields,
    values,
    errors: [],
    revision: loaded.revision,
    save: {
      method: "POST",
      path: "/api/dashboards/save-card-parameters",
      bodySchema: {
        type: "object",
        properties: {
          revision: { type: "string" },
          values: { type: "object", properties },
        },
        required: ["values"],
      },
    },
  };
}

function presentCardMetricSource(
  primaryKey: string, card: MetricReferenceEntry, spec: DashboardMetricDescription | null, locale?: string,
): PanelRecord {
  const metricName = spec ? spec.name || spec.id : card.query.metricId;
  const metricStatus = spec ? spec.status : "UNAVAILABLE";
  const parameterEntries = Object.entries(card.query.parameters);
  const parametersValue: PanelRecordFieldValue = parameterEntries.length > 0
    ? {
        kind: "json",
        value: Object.fromEntries(
          parameterEntries.map(([key, value]) => [key, value === undefined ? null : (value as RuntimeJsonValue)]),
        ),
      }
    : tForLocale(locale, "panels.dashboard.metricSource.noParameters");
  return {
    primaryKey,
    className: DASHBOARD_CARD,
    label: card.name,
    fields: {
      metric: {
        kind: "reference",
        className: METRIC_VIEW,
        primaryKey: card.query.metricId,
        label: metricName,
      },
      status: metricStatusLabel(metricStatus, locale),
      parameters: parametersValue,
    },
    tones: {
      status: metricStatusTone(metricStatus),
    },
    fieldLabels: {
      metric: tForLocale(locale, "panels.dashboard.metricSource.metricName"),
      status: tForLocale(locale, "panels.dashboard.metricSource.status"),
      parameters: tForLocale(locale, "panels.dashboard.metricSource.parameters"),
    },
  };
}

async function readOwnedMetricSourceCard({ userId, domainId }: ProductOwner, primaryKey: string) {
  const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
  const detail = await getOwnedDashboard(userId, domainId, dashboardId);
  const found = findCardWithGroup(detail, cardId);
  if (!found) throw new HttpError(404, "Dashboard card not found", "NOT_FOUND");
  return found.card;
}

const metricSourceFacts = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), metric: dashboardMetricDescriptionSchema }),
  z.object({ status: z.literal("unavailable") }),
]);

export async function prepareDashboardCardMetadataRead(
  owner: ProductOwner, primaryKey: string, method: "form" | "metricSource", params: Record<string, unknown>, locale?: string,
): Promise<{ call: NonNullable<JavaPanelRead["call"]>; present(payload: unknown): PanelFormDescription | PanelRecord }> {
  if (method === "form") {
    const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
    requireFormFieldNames(values, "values");
    const { card } = await ownedCard(owner, parseDashboardCardPrimaryKey(primaryKey));
    return {
      call: { type: METRIC_VIEW, name: "parameterForm", parameters: { primaryKey: card.query.metricId, parameters: card.query.parameters } },
      present: payload => presentCardParameterForm(dashboardParameterFormSchema.parse(payload), values),
    };
  }
  const card = await readOwnedMetricSourceCard(owner, primaryKey);
  return {
    call: { type: METRIC_VIEW, name: "describe", parameters: { primaryKey: card.query.metricId } },
    present(payload) {
      const facts = metricSourceFacts.parse(payload);
      return presentCardMetricSource(primaryKey, card, facts.status === "available" ? facts.metric : null, locale);
    },
  };
}

export function createDashboardCardOwnerReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const { userId, domainId } = owner;
  const { locale } = viewer;

  return {
    async record(primaryKey: string): Promise<PanelRecord> {
      const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
      const [detail, favoriteKeys] = await Promise.all([
        getOwnedDashboard(userId, domainId, dashboardId),
        readFavoriteKeySet(owner),
      ]);
      const found = findCardWithGroup(detail, cardId);
      if (!found) throw new HttpError(404, "Dashboard card not found", "NOT_FOUND");
      const order = found.kind === "metric"
        ? found.group.metrics.findIndex(item => item.id === cardId)
        : found.group.charts.findIndex(item => item.id === cardId);
      const favorited = favoriteKeys.has(favoriteTargetKey(DASHBOARD_CARD, dashboardCardPrimaryKey({ dashboardId, cardId })));
      return dashboardCardRecord(detail, found.group, found.groupIndex, found.card, Math.max(0, order), locale, favorited);
    },

    async form(primaryKey: string, params: FormReadParams): Promise<PanelFormDescription> {
      const request = parseDashboardCardPrimaryKey(primaryKey);
      const loaded = await metricCardParameterForm(
        { userId, domainId },
        request,
        new DashboardMetricClient(domainId, viewer),
      );
      return presentCardParameterForm(loaded, params.values);
    },

    async metricSource(primaryKey: string): Promise<PanelRecord> {
      const card = await readOwnedMetricSourceCard(owner, primaryKey);
      const client = new DashboardMetricClient(domainId, viewer);
      let spec: DashboardMetricDescription | null = null;
      try {
        spec = await client.describe(card.query.metricId);
      } catch (error) {
        if (!(error instanceof HttpError) || (error.status !== 404 && error.code !== "METRIC_UNAVAILABLE")) {
          throw error;
        }
      }
      return presentCardMetricSource(primaryKey, card, spec, locale);
    },
  };
}

export const dashboardLocalDataReadRegistrations: RegisteredDataReadRegistration[] = [
  localReadRegistration(DASHBOARD, "list", {
    read: (owner, _ranges, _facts, credentials) => createDashboardReadAdapter(owner, credentials).list(),
  }),
  localReadRegistration(DASHBOARD, "record", {
    read: (owner, _ranges, _facts, credentials, primaryKey) => createDashboardReadAdapter(owner, credentials).record(primaryKey!),
  }),
  localReadRegistration(DASHBOARD, "cards", {
    read: (owner, _ranges, _facts, credentials, primaryKey) => createDashboardReadAdapter(owner, credentials).cards(primaryKey!),
  }),
  localReadRegistration(DASHBOARD_CARD, "record", {
    read: (owner, _ranges, _facts, credentials, primaryKey) => createDashboardCardOwnerReadAdapter(owner, credentials).record(primaryKey!),
  }),
];
