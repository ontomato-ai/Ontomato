import { z } from "zod";
import {
  dashboardCardPrimaryKey,
  dashboardReplaceLayoutSchema,
  parseDashboardCardPrimaryKey,
} from "@ontomato/contracts/dashboard";
import { formFieldKey, formFieldPointer, type FormFieldError } from "@ontomato/contracts/form-fields";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import {
  CREATE_DASHBOARD,
  CREATE_DASHBOARD_GROUP,
  DASHBOARD,
  DASHBOARD_CARD,
  DELETE_DASHBOARD,
  DELETE_DASHBOARD_CARD,
  DELETE_DASHBOARD_GROUP,
  RENAME_DASHBOARD,
  RENAME_DASHBOARD_CARD,
  RENAME_DASHBOARD_GROUP,
  SAVE_DASHBOARD_LAYOUT,
} from "@ontomato/contracts/platform-object-types";
import { CHART_SOURCE_IN_USE } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { findGroup, getOwnedDashboard } from "./access";
import { DashboardMetricClient } from "./metric-client";
import { metricCardParameterForm, saveMetricCardParameters } from "./metric-data";
import {
  createDashboardDimension,
  createEmptyDashboard,
  deleteDashboardById,
  deleteDashboardCard,
  deleteDashboardDimension,
  renameDashboard,
  renameDashboardCard,
  renameDashboardDimension,
  replaceDashboardLayout,
} from "./mutations";

const dashboardObjectTarget = z.object({
  kind: z.literal("object"),
  objectType: z.literal(DASHBOARD),
  primaryKey: z.string().min(1),
}).strict();

const dashboardCardObjectTarget = z.object({
  kind: z.literal("object"),
  objectType: z.literal(DASHBOARD_CARD),
  primaryKey: z.string().min(1),
}).strict();

const nameInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
}).strict();

const createGroupInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  insertIndex: z.number().int().min(0).optional(),
}).strict();

const renameGroupInputSchema = z.object({
  groupId: z.string().min(1),
  title: z.string().trim(),
}).strict();

const deleteGroupInputSchema = z.object({
  groupId: z.string().min(1),
}).strict();

const saveLayoutInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  groups: dashboardReplaceLayoutSchema.shape.groups,
}).strict();

const emptyInputSchema = z.object({}).strict();
const idResultSchema = z.object({ id: z.string() }).strict();
const namedIdResultSchema = z.object({ id: z.string(), name: z.string() }).strict();
const groupResultSchema = z.object({ id: z.string(), title: z.string() }).strict();
const groupIdResultSchema = z.object({ groupId: z.string() }).strict();
const renamedGroupResultSchema = z.object({ groupId: z.string(), title: z.string() }).strict();
const cardResultSchema = z.object({ dashboardId: z.string(), cardId: z.string() }).strict();
const renamedCardResultSchema = z.object({ dashboardId: z.string(), cardId: z.string(), name: z.string() }).strict();
const savedCardParametersResultSchema = z.object({
  dashboardId: z.string(),
  cardId: z.string(),
  revision: z.string(),
}).strict();

function nameFieldInputSchema(labelKey: string) {
  return (_host: PanelOperationHost, locale?: string) => ({
    type: "object",
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        title: tForLocale(locale, labelKey),
      },
    },
    required: ["name"],
    additionalProperties: false,
  });
}

function dashboardRefusal(error: unknown, locale?: string): SinglePanelOperationOutcome {
  if (error instanceof HttpError) {
    if (error.code === CHART_SOURCE_IN_USE) {
      const projectionIds = Array.isArray((error.details as { projectionIds?: unknown } | undefined)?.projectionIds)
        ? (error.details as { projectionIds: string[] }).projectionIds
        : [];
      return {
        kind: "refusal",
        code: CHART_SOURCE_IN_USE,
        message: tForLocale(locale, "panels.dashboard.errors.chartSourceInUse", { count: projectionIds.length || 1 }),
        ...(projectionIds.length > 0 ? { details: { projectionIds } } : {}),
      };
    }
    if (error.status >= 400 && error.status < 500) {
      return {
        kind: "refusal",
        code: error.code || "INVALID_REQUEST",
        message: error.message,
      };
    }
  }
  throw error;
}

async function dashboardLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  const { userId, domainId } = host.initiator.owner;
  const detail = await getOwnedDashboard(userId, domainId, target.primaryKey);
  return detail.name;
}

async function cardLabel(host: PanelOperationHost, target: PanelRecordTarget): Promise<string> {
  const { userId, domainId } = host.initiator.owner;
  const { dashboardId, cardId } = parseDashboardCardPrimaryKey(target.primaryKey);
  const detail = await getOwnedDashboard(userId, domainId, dashboardId);
  const card = detail.groups.flatMap(group => [...group.charts, ...group.metrics]).find(item => item.id === cardId);
  return card?.name ?? cardId;
}

const deleteDashboardImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_DASHBOARD}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const { userId, domainId } = host.initiator.owner;
    const detail = await getOwnedDashboard(userId, domainId, target.primaryKey);
    const cards = detail.groups.flatMap(group => [...group.metrics, ...group.charts]);
    return {
      summary: tForLocale(host.locale, "panels.dashboard.confirmation.deleteDashboardImpact", {
        name: detail.name,
        count: cards.length,
      }),
      total: Math.max(1, cards.length),
      objects: cards.length > 0
        ? cards.map(card => ({
            target: { objectType: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey({ dashboardId: detail.id, cardId: card.id }) },
            label: card.name,
          }))
        : [{ target: { objectType: DASHBOARD, primaryKey: detail.id }, label: detail.name }],
    };
  },
};

const deleteGroupImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_DASHBOARD_GROUP}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const { groupId } = deleteGroupInputSchema.parse(calls[0]!.input);
    const { userId, domainId } = host.initiator.owner;
    const detail = await getOwnedDashboard(userId, domainId, target.primaryKey);
    const group = findGroup(detail, groupId);
    const cards = [...group.metrics, ...group.charts];
    return {
      summary: tForLocale(host.locale, "panels.dashboard.confirmation.deleteGroupImpact", {
        title: group.title || tForLocale(host.locale, "panels.dashboard.untitledGroup"),
        count: cards.length,
      }),
      total: Math.max(1, cards.length),
      objects: cards.length > 0
        ? cards.map(card => ({
            target: { objectType: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey({ dashboardId: detail.id, cardId: card.id }) },
            label: card.name,
          }))
        : [{ target: { objectType: DASHBOARD, primaryKey: detail.id }, label: detail.name }],
    };
  },
};

const deleteCardImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_DASHBOARD_CARD}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const name = await cardLabel(host, target);
    return {
      summary: tForLocale(host.locale, "panels.dashboard.confirmation.deleteCardImpact", { name }),
      total: 1,
      objects: [{ target: { objectType: DASHBOARD_CARD, primaryKey: target.primaryKey }, label: name }],
    };
  },
};

function mapParameterErrors(errors: readonly FormFieldError[]): FormFieldError[] {
  return errors.map(error => {
    const key = formFieldKey(error.field, "/values/");
    return key !== null ? { ...error, field: formFieldPointer("/", key) } : error;
  });
}

export const dashboardServerOperations = [
  {
    handlerRef: CREATE_DASHBOARD,
    labelKey: "panels.dashboard.operations.create",
    kind: "action",
    binding: { kind: "PlatformOperation", id: CREATE_DASHBOARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetSchema: z.null(),
    inputSchema: nameInputSchema,
    describeInputSchema: nameFieldInputSchema("panels.dashboard.fields.name"),
    resultSchema: namedIdResultSchema,
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { name } = nameInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        const created = await createEmptyDashboard(userId, domainId, { name });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.created", { name: created.name }),
          data: created,
          created: { objectType: DASHBOARD, primaryKey: created.id },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey: created.id }],
            objectTypes: [DASHBOARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: RENAME_DASHBOARD,
    labelKey: "panels.dashboard.operations.rename",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RENAME_DASHBOARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    done: (host, name) => tForLocale(host.locale, "panels.dashboard.messages.renamed", { name }),
    inputSchema: nameInputSchema,
    describeInputSchema: nameFieldInputSchema("panels.dashboard.fields.name"),
    resultSchema: namedIdResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { name } = nameInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await renameDashboard(userId, domainId, { id: primaryKey, name });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.renamed", { name }),
          data: { id: primaryKey, name },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: DELETE_DASHBOARD,
    labelKey: "panels.dashboard.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_DASHBOARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    done: (host, name) => tForLocale(host.locale, "panels.dashboard.messages.deleted", { name }),
    inspectImpact: deleteDashboardImpact,
    inputSchema: emptyInputSchema,
    resultSchema: idResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await deleteDashboardById(userId, domainId, { id: primaryKey });
        return {
          kind: "success",
          data: { id: primaryKey },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: SAVE_DASHBOARD_LAYOUT,
    labelKey: "panels.dashboard.operations.saveLayout",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SAVE_DASHBOARD_LAYOUT },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    done: (host, name) => tForLocale(host.locale, "panels.dashboard.messages.layoutSaved", { name }),
    inputSchema: saveLayoutInputSchema,
    resultSchema: idResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { name, groups } = saveLayoutInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await replaceDashboardLayout(userId, domainId, { id: primaryKey, groups }, host.executor.credentials, name);
        return {
          kind: "success",
          data: { id: primaryKey },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: CREATE_DASHBOARD_GROUP,
    labelKey: "panels.dashboard.operations.createGroup",
    kind: "action",
    binding: { kind: "PlatformOperation", id: CREATE_DASHBOARD_GROUP },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    inputSchema: createGroupInputSchema,
    describeInputSchema: (_host, locale) => ({
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          title: tForLocale(locale, "panels.dashboard.fields.groupTitle"),
        },
        insertIndex: {
          type: "integer",
          minimum: 0,
          title: tForLocale(locale, "panels.dashboard.fields.insertIndex"),
        },
      },
      required: ["title"],
      additionalProperties: false,
    }),
    resultSchema: groupResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { title, insertIndex } = createGroupInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        const created = await createDashboardDimension(userId, domainId, {
          id: primaryKey,
          dimensionName: title,
          insertIndex,
        });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.groupCreated", { title: created.title }),
          data: created,
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: RENAME_DASHBOARD_GROUP,
    labelKey: "panels.dashboard.operations.renameGroup",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RENAME_DASHBOARD_GROUP },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    inputSchema: renameGroupInputSchema,
    describeInputSchema: (_host, locale) => ({
      type: "object",
      properties: {
        groupId: { type: "string", minLength: 1 },
        title: {
          type: "string",
          title: tForLocale(locale, "panels.dashboard.fields.groupTitle"),
        },
      },
      required: ["groupId", "title"],
      additionalProperties: false,
    }),
    resultSchema: renamedGroupResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { groupId, title } = renameGroupInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await renameDashboardDimension(userId, domainId, { id: primaryKey, groupId, dimensionName: title });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.groupRenamed", {
            title: title || tForLocale(locale, "panels.dashboard.untitledGroup"),
          }),
          data: { groupId, title },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: DELETE_DASHBOARD_GROUP,
    labelKey: "panels.dashboard.operations.deleteGroup",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_DASHBOARD_GROUP },
    effect: "write",
    batch: false,
    targetType: DASHBOARD,
    targetInput: "dashboard",
    targetSchema: dashboardObjectTarget,
    targetLabel: dashboardLabel,
    inspectImpact: deleteGroupImpact,
    inputSchema: deleteGroupInputSchema,
    resultSchema: groupIdResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardObjectTarget.parse(target);
      const { groupId } = deleteGroupInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await deleteDashboardDimension(userId, domainId, { id: primaryKey, groupId });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.groupDeleted"),
          data: { groupId },
          affected: {
            objects: [{ objectType: DASHBOARD, primaryKey }],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: RENAME_DASHBOARD_CARD,
    labelKey: "panels.dashboard.operations.renameCard",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RENAME_DASHBOARD_CARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD_CARD,
    targetInput: "card",
    targetSchema: dashboardCardObjectTarget,
    targetLabel: cardLabel,
    done: (host, name) => tForLocale(host.locale, "panels.dashboard.messages.cardRenamed", { name }),
    inputSchema: nameInputSchema,
    describeInputSchema: nameFieldInputSchema("panels.dashboard.fields.cardName"),
    resultSchema: renamedCardResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardCardObjectTarget.parse(target);
      const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
      const { name } = nameInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await renameDashboardCard(userId, domainId, { dashboardId, cardId, name });
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.cardRenamed", { name }),
          data: { dashboardId, cardId, name },
          affected: {
            objects: [
              { objectType: DASHBOARD, primaryKey: dashboardId },
              { objectType: DASHBOARD_CARD, primaryKey },
            ],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: DELETE_DASHBOARD_CARD,
    labelKey: "panels.dashboard.operations.deleteCard",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_DASHBOARD_CARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD_CARD,
    targetInput: "card",
    targetSchema: dashboardCardObjectTarget,
    targetLabel: cardLabel,
    done: (host, name) => tForLocale(host.locale, "panels.dashboard.messages.cardDeleted", { name }),
    inspectImpact: deleteCardImpact,
    inputSchema: emptyInputSchema,
    resultSchema: cardResultSchema,
    async execute(host: PanelOperationHost, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardCardObjectTarget.parse(target);
      const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      try {
        await deleteDashboardCard(userId, domainId, { dashboardId, cardId });
        return {
          kind: "success",
          data: { dashboardId, cardId },
          affected: {
            objects: [
              { objectType: DASHBOARD, primaryKey: dashboardId },
              { objectType: DASHBOARD_CARD, primaryKey },
            ],
            objectTypes: [DASHBOARD, DASHBOARD_CARD],
          },
        };
      } catch (error) {
        return dashboardRefusal(error, locale);
      }
    },
  },
  {
    handlerRef: `${DASHBOARD_CARD}.save`,
    labelKey: "panels.dashboard.operations.saveCardParameters",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: DASHBOARD_CARD },
    effect: "write",
    batch: false,
    targetType: DASHBOARD_CARD,
    targetSchema: dashboardCardObjectTarget,
    inputSchema: panelFormSaveInputSchema,
    resultSchema: savedCardParametersResultSchema,
    draftInput: (input: Record<string, unknown>) => panelFormSaveInputSchema.parse(input).values,
    create: false,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = dashboardCardObjectTarget.parse(target);
      const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
      const { values, revision, submittedFields } = panelFormSaveInputSchema.parse(input);
      const { userId, domainId } = host.executor.owner;
      const locale = host.locale ?? host.executor.credentials.locale;
      const client = new DashboardMetricClient(domainId, host.executor.credentials);
      try {
        const currentForm = await metricCardParameterForm({ userId, domainId }, { dashboardId, cardId }, client);
        const readOnlySet = new Set(currentForm.readOnly);
        const submittedSet = submittedFields !== undefined ? new Set(submittedFields) : null;
        const stringValues: Record<string, string> = {};
        for (const [key, rawValue] of Object.entries(values)) {
          if (readOnlySet.has(key)) continue;
          if (submittedSet !== null && !submittedSet.has(formFieldPointer("/", key))) continue;
          if (typeof rawValue === "string") stringValues[key] = rawValue;
          else if (rawValue !== null && rawValue !== undefined) stringValues[key] = String(rawValue);
        }
        const effectiveRevision = revision !== undefined ? String(revision) : currentForm.revision;
        const saved = await saveMetricCardParameters(
          { userId, domainId },
          { dashboardId, cardId, revision: effectiveRevision, values: stringValues },
          client,
        );
        return {
          kind: "success",
          message: tForLocale(locale, "panels.dashboard.messages.parametersSaved"),
          data: { dashboardId, cardId, revision: saved.revision },
          affected: {
            objects: [
              { objectType: DASHBOARD_CARD, primaryKey },
              { objectType: DASHBOARD, primaryKey: dashboardId },
            ],
            objectTypes: [DASHBOARD_CARD],
          },
        };
      } catch (error) {
        if (error instanceof HttpError && error.code === "METRIC_PARAMETERS_INVALID") {
          const rawErrors = Array.isArray((error.details as { errors?: unknown } | undefined)?.errors)
            ? (error.details as { errors: FormFieldError[] }).errors
            : [];
          return {
            kind: "refusal",
            code: "METRIC_PARAMETERS_INVALID",
            message: tForLocale(locale, "panels.dashboard.errors.invalidParameters"),
            ...(rawErrors.length > 0 ? { errors: mapParameterErrors(rawErrors) } : {}),
          };
        }
        if (error instanceof HttpError && error.code === "METRIC_SPEC_CHANGED") {
          return {
            kind: "refusal",
            code: "METRIC_SPEC_CHANGED",
            message: tForLocale(locale, "panels.dashboard.errors.metricSpecChanged"),
          };
        }
        return dashboardRefusal(error, locale);
      }
    },
  },
] as const satisfies readonly PanelServerOperation[];
