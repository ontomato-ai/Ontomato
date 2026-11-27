import { z } from "zod";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import {
  dashboardCardPrimaryKey,
  parseDashboardCardPrimaryKey,
  type MetricReferenceEntry,
} from "@ontomato/contracts/dashboard";
import type { PanelOperationTargetTypes } from "@ontomato/contracts/panel-operations";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  favoriteMoveDirectionSchema,
  favoriteTargetGroupSchema,
  type FavoriteTargetGroup,
  type HomePinnedObject,
} from "@ontomato/contracts/platform-home";
import { applicationRootPath, isPanelApplication } from "@ontomato/contracts/platform-identity";
import {
  ADD_FAVORITE,
  AGENT_DEFINITION,
  AGENT_SESSION,
  APPLICATION,
  DASHBOARD,
  DASHBOARD_CARD,
  FAVORITE,
  MOVE_FAVORITE,
  REMOVE_FAVORITE,
} from "@ontomato/contracts/platform-object-types";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assistantStore } from "../assistant/store";
import { getOwnedDashboard } from "../dashboard/access";
import { listDashboards } from "../dashboard/store";
import {
  addFavoriteTarget,
  isFavoriteTarget,
  moveFavoriteTarget,
  readAllFavoriteState,
  readPinnedObjects,
  removeFavoriteTarget,
} from "../platform-home/service";
import { createCustomerOntologyReadAdapter, customerObjectRecordCall, customerObjectRecordResult } from "../ontology-model/customer-reads";
import type { ProductOwner } from "../product-governance/service-authentication";
import { cleanSessionDisplayTitle, formatShortDateTime, sessionOpenPath } from "./agent-session-panel";
import { APPLICATION_NAVIGATION_READ, applicationCatalogueClient, applicationNavigationFactsSchema } from "./application-catalogue";
import type { JavaPanelReadResult, PanelReadRanges, PanelReadVisibility, PreparedOwnerReadFacts } from "./java-panel-reads";
import type { PanelReadSelection } from "./panel-owner-reads";
import { defaultRegisteredJavaCall, localReadRegistration, ownerFactsPlan, ownerReadPlan, readyPayload, type RegisteredDataReadRegistration } from "./registered-data-read";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

export const FAVORITE_TARGET_TYPES: PanelOperationTargetTypes = {
  platformTypes: [APPLICATION, AGENT_DEFINITION, DASHBOARD, DASHBOARD_CARD, AGENT_SESSION],
  customerObjects: true,
};

export function preparePersonalFavoriteRead(
  owner: ProductOwner, viewer: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
) {
  if (selection.typeId !== FAVORITE || selection.method !== "list") return undefined;
  const group = params.targetGroup;
  if (group === "apps") return {
    visibility: [{ kind: "AGENT", verbs: ["USE"] }] satisfies PanelReadVisibility[],
    call: APPLICATION_NAVIGATION_READ,
    async present(facts: unknown, ranges?: PanelReadRanges) {
      const range = ranges?.AGENT?.USE;
      if (!range) throw new HttpError(502, "The panel read owner did not provide AGENT/USE visibility", "PANEL_READ_OWNER_RESPONSE_INVALID");
      const applications = applicationNavigationFactsSchema.parse(facts);
      const { listAssistantAgentsInRange } = await import("../assistant/agents");
      return createFavoriteReadAdapter(owner, viewer).list({ targetGroup: group }, {
        applications: () => Promise.resolve(applications),
        agents: () => listAssistantAgentsInRange(owner, viewer, range).then(result => result.agents),
      });
    },
  };
  if (group !== "dashboards" && group !== "dashboardCards" && group !== "sessions") return undefined;
  return { call: undefined, present: () => createFavoriteReadAdapter(owner, viewer).list({ targetGroup: group }) };
}

export function isFavoriteObjectRead(selection: PanelReadSelection, params: Record<string, unknown>) {
  return selection.typeId === FAVORITE && selection.method === "list" && params.targetGroup === "objects";
}

export async function prepareScopedFavoriteObjectRead(owner: ProductOwner, locale?: string) {
  const objects = await readPinnedObjects(owner);
  return {
    call: {
      type: "customer:ObjectType", name: "favoriteRecords",
      parameters: { objects: objects.map(({ className, primaryKey }) => ({ className, primaryKey })) },
    },
    present(payload: unknown) {
      const records = z.array(z.unknown()).length(objects.length).parse(payload);
      return presentFavoriteObjectRows(objects, records.map((record, index) => readFavoriteObjectTitle(
        objects[index], record === null ? { status: "empty" } : { status: "ready", payload: record },
      )), locale);
    },
  };
}

export async function prepareFavoriteObjectRead(
  owner: ProductOwner, selection: PanelReadSelection, params: Record<string, unknown>, locale?: string,
): Promise<PreparedOwnerReadFacts | undefined> {
  if (!isFavoriteObjectRead(selection, params)) return;
  const objects = await readPinnedObjects(owner);
  return {
    facts: objects.map(({ className, primaryKey }) => ({ call: customerObjectRecordCall(className, primaryKey) })),
    present: (_viewer, facts) => presentFavoriteObjectRows(objects,
      facts.map((fact, index) => readFavoriteObjectTitle(objects[index], fact)), locale),
  };
}

const GALLERY_EXCLUDED_APP_IDS = new Set(["home", "personal-workspace", "workplace", "application-gallery"]);

const favoriteTargetSchema = z.object({
  kind: z.literal("object"),
  objectType: z.string().min(1).max(200),
  primaryKey: z.string().min(1).max(1000),
}).strict().refine(
  ({ objectType }) => !objectType.startsWith("platform:") || FAVORITE_TARGET_TYPES.platformTypes!.includes(objectType),
  "Unsupported favorite target type",
);

const addInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

const emptyInputSchema = z.object({}).strict();

const moveInputSchema = z.object({
  direction: favoriteMoveDirectionSchema,
}).strict();

const addResultSchema = z.object({ favorited: z.literal(true) }).strict();
const removeResultSchema = z.object({ favorited: z.literal(false) }).strict();
const moveResultSchema = z.object({ moved: z.literal(true) }).strict();

const favoriteText = (locale: string | undefined, key: string) => tForLocale(locale, `panels.favorite.${key}`);

function favoriteAffected(objectType: string, primaryKey: string) {
  return {
    objectTypes: objectType === AGENT_DEFINITION
      ? [FAVORITE, objectType, APPLICATION]
      : [FAVORITE, objectType],
    objects: [
      { objectType, primaryKey },
    ],
  };
}

function resolveApplicationOpenPath(app: Awaited<ReturnType<ReturnType<typeof applicationCatalogueClient>["navigation"]>>[number]): string {
  if (app.entry.path.startsWith("/__external/") || app.kind === "link") return app.entry.path;
  if (isPanelApplication(app) || app.kind === "connected") return applicationRootPath(app.id);
  return app.entry.home ?? app.entry.path;
}

function customerObjectOpenPath(className: string, primaryKey: string): string {
  return `/browser/views/${encodeURIComponent(className)}?key=${encodeURIComponent(primaryKey)}&from=workspace`;
}

function dashboardOpenPath(dashboardId: string, cardId?: string): string {
  return cardId
    ? `/dashboards?dashboardId=${encodeURIComponent(dashboardId)}&cardId=${encodeURIComponent(cardId)}`
    : `/dashboards?dashboardId=${encodeURIComponent(dashboardId)}`;
}

function shouldInclude(group: FavoriteTargetGroup, candidate: FavoriteTargetGroup): boolean {
  if (group === "all") return true;
  if (group === "apps") return candidate === "applications" || candidate === "agents";
  return group === candidate;
}

type FavoriteObjectTitle = { title: string; available: boolean };

function favoriteObjectTitle(primaryKey: string, savedTitle?: string, recordLabel?: string) {
  return recordLabel?.trim() || savedTitle?.trim() || primaryKey;
}

function readFavoriteObjectTitle(object: HomePinnedObject, fact: JavaPanelReadResult): FavoriteObjectTitle {
  const { className, primaryKey, title: savedTitle } = object;
  const unavailable = { title: favoriteObjectTitle(primaryKey, savedTitle), available: false };
  if (fact.status === "forbidden" || fact.status === "empty") return unavailable;
  if (fact.status === "error") {
    if (fact.code === "OBJECT_TYPE_NOT_FOUND") return unavailable;
    throw new HttpError(502, fact.error, fact.code ?? undefined);
  }
  const result = customerObjectRecordResult(className, primaryKey, fact.payload);
  if (!result.ok) {
    if (result.error.status === 403 || result.error.status === 404) return unavailable;
    throw result.error;
  }
  return { title: favoriteObjectTitle(primaryKey, savedTitle, result.record.label), available: true };
}

function favoriteFieldLabels(locale?: string) {
  return {
    className: favoriteText(locale, "className"),
    primaryKey: favoriteText(locale, "primaryKey"),
    title: favoriteText(locale, "title"),
  };
}

function presentFavoriteObjectRows(
  objects: readonly HomePinnedObject[], titles: readonly FavoriteObjectTitle[], locale?: string,
): PanelRecord[] {
  const fieldLabels = favoriteFieldLabels(locale);
  const unavailableLabel = favoriteText(locale, "unavailable");
  return objects.map(({ className, primaryKey }, index) => {
    const { title, available } = titles[index];
    const label = available ? title : unavailableLabel;
    const canMoveUp = index > 0;
    const canMoveDown = index < objects.length - 1;
    return {
      className, primaryKey, label, subtitle: className,
      fields: {
        className, primaryKey, title: label, favorite: true,
        canMoveUp, canMoveDown, unavailable: !available,
      },
      fieldLabels,
      outputs: {
        openPath: available ? customerObjectOpenPath(className, primaryKey) : "",
        favorited: true, canMoveUp, canMoveDown, unavailable: !available,
      },
    };
  });
}

async function resolveCustomerObjectTitle(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  className: string,
  primaryKey: string,
  fallback?: string,
): Promise<FavoriteObjectTitle> {
  try {
    const record = await createCustomerOntologyReadAdapter(owner, viewer).record(className, primaryKey);
    return { title: favoriteObjectTitle(primaryKey, fallback, record.label), available: true };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      return { title: favoriteObjectTitle(primaryKey, fallback), available: false };
    }
    return { title: favoriteObjectTitle(primaryKey, fallback), available: true };
  }
}

function favoriteDirectory(owner: ProductOwner, viewer: AssistantCredentials) {
  return {
    applications: () => applicationCatalogueClient(viewer).navigation().catch(() => []),
    agents: () => import("../assistant/service").then(({ assistantService }) =>
      assistantService.agents(owner, viewer).then(result => result.agents)).catch(() => []),
  };
}

export function createFavoriteReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const language = resolveLocale(viewer.locale);
  const unavailableLabel = favoriteText(viewer.locale, "unavailable");
  const untitledSession = tForLocale(viewer.locale, "panels.agentSession.untitled");
  const fieldLabels = favoriteFieldLabels(viewer.locale);

  const DEFAULT_PREVIEW_METRICS_PER_BOARD = 3;
  const DEFAULT_PREVIEW_CHARTS_PER_BOARD = 2;
  const MAX_PREVIEW_METRICS = 6;
  const MAX_PREVIEW_CHARTS = 4;

  type SelectedPreviewEntry = {
    dashboardId: string;
    dashboardName: string;
    cardId: string;
    kind: "metric" | "chart";
    entry: MetricReferenceEntry;
  };

  async function selectFollowedDashboardCards(state: Awaited<ReturnType<typeof readAllFavoriteState>>) {
    const boardDetails = new Map<string, Awaited<ReturnType<typeof getOwnedDashboard>> | null>();
    await Promise.all(state.dashboardIds.map(async dashboardId => {
      try {
        boardDetails.set(dashboardId, await getOwnedDashboard(owner.userId, owner.domainId, dashboardId));
      } catch {
        boardDetails.set(dashboardId, null);
      }
    }));

    const metrics: SelectedPreviewEntry[] = [];
    const charts: SelectedPreviewEntry[] = [];
    let missingCount = 0;

    for (const dashboardId of state.dashboardIds) {
      const explicitIds = state.dashboardCards[dashboardId] ?? [];
      const detail = boardDetails.get(dashboardId);
      if (!detail) {
        missingCount += explicitIds.length;
        continue;
      }
      const allMetrics = detail.groups.flatMap(g => g.metrics);
      const allCharts = detail.groups.flatMap(g => g.charts);
      const cardsById = new Map<string, MetricReferenceEntry>([
        ...allMetrics.map(card => [card.id, card] as const),
        ...allCharts.map(card => [card.id, card] as const),
      ]);
      const chosenIds = explicitIds.length > 0
        ? explicitIds
        : [
            ...allMetrics.slice(0, DEFAULT_PREVIEW_METRICS_PER_BOARD).map(c => c.id),
            ...allCharts.slice(0, DEFAULT_PREVIEW_CHARTS_PER_BOARD).map(c => c.id),
          ];
      for (const cardId of chosenIds) {
        const entry = cardsById.get(cardId);
        if (!entry) {
          if (explicitIds.length > 0) missingCount += 1;
          continue;
        }
        const kind: "metric" | "chart" = "chartFile" in entry ? "chart" : "metric";
        const item: SelectedPreviewEntry = {
          dashboardId,
          dashboardName: detail.name,
          cardId,
          kind,
          entry,
        };
        if (kind === "metric") {
          if (metrics.length < MAX_PREVIEW_METRICS) metrics.push(item);
        } else if (charts.length < MAX_PREVIEW_CHARTS) {
          charts.push(item);
        }
      }
    }

    return {
      items: [...metrics, ...charts],
      metricCount: metrics.length,
      chartCount: charts.length,
      missingCount,
    };
  }

  return {
    async list(params: { targetGroup?: FavoriteTargetGroup } = {}, directory = favoriteDirectory(owner, viewer)): Promise<PanelRecord[]> {
      const group = favoriteTargetGroupSchema.parse(params.targetGroup ?? "all");
      const state = await readAllFavoriteState(owner);
      const rows: PanelRecord[] = [];

      const needApps = shouldInclude(group, "applications");
      const needAgents = shouldInclude(group, "agents");
      const needDashboards = shouldInclude(group, "dashboards");
      const needDashboardCards = shouldInclude(group, "dashboardCards");
      const needSessions = shouldInclude(group, "sessions");
      const needObjects = shouldInclude(group, "objects");

      const [catalog, agents, dashboards, sessionsMap] = await Promise.all([
        needApps ? directory.applications() : Promise.resolve([]),
        needAgents ? directory.agents() : Promise.resolve([]),
        needDashboards ? listDashboards(owner.userId, owner.domainId).catch(() => []) : Promise.resolve([]),
        needSessions && state.pinnedSessions.length > 0
          ? assistantStore.ownedSessionsByIds(owner, state.pinnedSessions).catch(() => new Map())
          : Promise.resolve(new Map()),
      ]);

      if (needApps || needAgents) {
        const appsById = new Map(catalog.map(app => [app.id, app]));
        const agentsById = new Map(agents.filter(a => a.enabled).map(a => [a.id, a]));
        const filtered = state.favorites.filter(item =>
          (item.kind === "application" && needApps) || (item.kind === "agent" && needAgents),
        );
        filtered.forEach((item, index) => {
          const canMoveUp = index > 0;
          const canMoveDown = index < filtered.length - 1;
          if (item.kind === "application") {
            const app = appsById.get(item.id);
            const available = Boolean(app && !GALLERY_EXCLUDED_APP_IDS.has(app.id));
            const label = app ? (localizedApplicationText(app.names, language) ?? app.id) : item.id;
            const description = app ? localizedApplicationText(app.descriptions, language) : undefined;
            const openPath = app ? resolveApplicationOpenPath(app) : "";
            rows.push({
              className: APPLICATION,
              primaryKey: item.id,
              label: available ? label : unavailableLabel,
              ...(available && description ? { subtitle: description } : {}),
              fields: {
                className: APPLICATION,
                primaryKey: item.id,
                title: available ? label : unavailableLabel,
                icon: app?.icon ?? "app-window",
                category: app?.category ?? "",
                favorite: true,
                canMoveUp,
                canMoveDown,
                unavailable: !available,
              },
              fieldLabels,
              outputs: {
                openPath: available ? openPath : "",
                favorited: true,
                canMoveUp,
                canMoveDown,
                unavailable: !available,
              },
            });
          } else {
            const agent = agentsById.get(item.id);
            const available = Boolean(agent);
            const openPath = available ? `/agents/chat?agentId=${encodeURIComponent(item.id)}` : "";
            rows.push({
              className: AGENT_DEFINITION,
              primaryKey: item.id,
              label: available ? agent!.name : unavailableLabel,
              ...(available && agent!.description ? { subtitle: agent!.description } : {}),
              fields: {
                className: AGENT_DEFINITION,
                primaryKey: item.id,
                title: available ? agent!.name : unavailableLabel,
                icon: agent?.icon ?? "",
                favorite: true,
                canMoveUp,
                canMoveDown,
                unavailable: !available,
              },
              fieldLabels,
              outputs: {
                openPath,
                favorited: true,
                canMoveUp,
                canMoveDown,
                unavailable: !available,
              },
            });
          }
        });
      }

      if (needDashboards) {
        const boardsById = new Map(dashboards.map(board => [board.id, board]));
        state.dashboardIds.forEach((dashboardId, index) => {
          const board = boardsById.get(dashboardId);
          const available = Boolean(board);
          const selectedCardIds = state.dashboardCards[dashboardId] ?? [];
          rows.push({
            className: DASHBOARD,
            primaryKey: dashboardId,
            label: available ? board!.name : unavailableLabel,
            fields: {
              className: DASHBOARD,
              primaryKey: dashboardId,
              title: available ? board!.name : unavailableLabel,
              selectedCardIds: { kind: "json", value: selectedCardIds },
              favorite: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.dashboardIds.length - 1,
              unavailable: !available,
            },
            fieldLabels,
            outputs: {
              openPath: available ? dashboardOpenPath(dashboardId) : "",
              favorited: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.dashboardIds.length - 1,
              unavailable: !available,
            },
          });
        });
      }

      if (needDashboardCards) {
        const { items: selectedEntries } = await selectFollowedDashboardCards(state);
        const total = selectedEntries.length;
        rows.push(...selectedEntries.map((item, index): PanelRecord => {
          const { dashboardId, dashboardName, cardId, kind, entry } = item;
          const pk = dashboardCardPrimaryKey({ dashboardId, cardId });
          const isChart = kind === "chart";

          return {
            className: DASHBOARD_CARD,
            primaryKey: pk,
            label: entry.name,
            subtitle: dashboardName,
            fields: {
              className: DASHBOARD_CARD,
              primaryKey: pk,
              dashboardId,
              dashboardName,
              cardId,
              groupId: "preview",
              kind,
              cardKind: kind,
              colSpan: isChart ? 6 : 4,
              rowSpan: isChart ? 2 : 1,
              order: index,
              title: entry.name,
              ...(!("chartFile" in entry) ? { valueField: entry.valueField } : {}),
              ...(!("chartFile" in entry) && entry.unit ? { unit: entry.unit } : {}),
              ...(!("chartFile" in entry) && entry.formats ? { formats: { kind: "json", value: entry.formats } } : {}),
              ...("chartFile" in entry ? { chartFile: { kind: "json", value: entry.chartFile } } : {}),
              favorite: true,
              canMoveUp: index > 0,
              canMoveDown: index < total - 1,
              unavailable: false,
            },
            fieldLabels,
            outputs: {
              openPath: dashboardOpenPath(dashboardId, cardId),
              favorited: true,
              canMoveUp: index > 0,
              canMoveDown: index < total - 1,
              unavailable: false,
            },
          };
        }));
      }

      if (needSessions) {
        state.pinnedSessions.forEach((sessionId, index) => {
          const session = sessionsMap.get(sessionId);
          const available = Boolean(session);
          const displayTitle = available ? cleanSessionDisplayTitle(session!.title, untitledSession) : unavailableLabel;
          const subtitle = available
            ? [session!.agentName, formatShortDateTime(session!.updatedAt, language)].filter(Boolean).join(" · ")
            : "";
          rows.push({
            className: AGENT_SESSION,
            primaryKey: sessionId,
            label: displayTitle,
            ...(subtitle ? { subtitle } : {}),
            fields: {
              className: AGENT_SESSION,
              primaryKey: sessionId,
              title: displayTitle,
              agentId: session?.agentId ?? "",
              agentName: session?.agentName ?? "",
              updatedAt: session?.updatedAt ?? "",
              favorite: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.pinnedSessions.length - 1,
              unavailable: !available,
            },
            fieldLabels,
            outputs: {
              openPath: available ? sessionOpenPath(session!.agentId, sessionId) : "",
              favorited: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.pinnedSessions.length - 1,
              unavailable: !available,
            },
          });
        });
      }

      if (needObjects) {
        const resolvedObjects = await Promise.all(
          state.pinnedObjects.map(item =>
            resolveCustomerObjectTitle(owner, viewer, item.className, item.primaryKey, item.title),
          ),
        );
        rows.push(...presentFavoriteObjectRows(state.pinnedObjects, resolvedObjects, viewer.locale));
      }

      return rows;
    },

    async dashboardCardsStatus(): Promise<PanelRecord> {
      const state = await readAllFavoriteState(owner);
      const { metricCount, chartCount, missingCount } = await selectFollowedDashboardCards(state);
      return {
        className: FAVORITE,
        primaryKey: "dashboardCardsStatus",
        label: "dashboardCardsStatus",
        fields: {
          ...(missingCount > 0 ? { missingCount } : {}),
          metricCount,
          chartCount,
        },
        outputs: {
          missingCount,
          metricCount,
          chartCount,
        },
      };
    },

    async status(params: {
      object?: { className: string; primaryKey: string };
      objectType?: string;
      primaryKey?: string;
    }): Promise<PanelRecord> {
      const objectType = params.object?.className ?? params.objectType;
      const primaryKey = params.object?.primaryKey ?? params.primaryKey;
      if (!objectType || !primaryKey) {
        throw new HttpError(400, "Favorite status requires object or objectType and primaryKey", "INVALID_REQUEST");
      }
      const [favorited, state] = await Promise.all([
        isFavoriteTarget(owner, objectType, primaryKey),
        readAllFavoriteState(owner),
      ]);
      const pinnedObj = !objectType.startsWith("platform:")
        ? state.pinnedObjects.find(item => item.className === objectType && item.primaryKey === primaryKey)
        : undefined;
      const title = pinnedObj?.title ?? "";
      return {
        className: objectType,
        primaryKey,
        label: title || primaryKey,
        fields: {
          className: objectType,
          primaryKey,
          title,
          status: "",
        },
        fieldLabels,
        outputs: {
          favorited,
          className: objectType,
          primaryKey,
          title,
        },
      };
    },
  };
}

async function resolveTargetNameAndVerify(
  host: PanelOperationHost,
  objectType: string,
  primaryKey: string,
  suppliedTitle?: string,
): Promise<string> {
  const { owner, credentials } = host.executor;
  const language = resolveLocale(host.locale ?? credentials.locale);
  if (objectType === APPLICATION) {
    if (GALLERY_EXCLUDED_APP_IDS.has(primaryKey)) {
      throw new HttpError(400, tForLocale(language, "panels.productCatalog.favoriteNotAllowed"), "FAVORITE_NOT_ALLOWED");
    }
    const apps = await applicationCatalogueClient(credentials).navigation();
    const app = apps.find(entry => entry.id === primaryKey);
    if (!app) {
      throw new HttpError(404, tForLocale(language, "panels.productCatalog.applicationNotFound"), "NOT_FOUND");
    }
    return localizedApplicationText(app.names, language) ?? app.id;
  }
  if (objectType === AGENT_DEFINITION) {
    const { assistantService } = await import("../assistant/service");
    const { agents } = await assistantService.agents(owner, credentials);
    const agent = agents.find(entry => entry.id === primaryKey && entry.enabled);
    if (!agent) {
      throw new HttpError(404, tForLocale(language, "panels.agentDefinition.notFound"), "NOT_FOUND");
    }
    return agent.name;
  }
  if (objectType === DASHBOARD) {
    const detail = await getOwnedDashboard(owner.userId, owner.domainId, primaryKey);
    return detail.name;
  }
  if (objectType === DASHBOARD_CARD) {
    const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
    const detail = await getOwnedDashboard(owner.userId, owner.domainId, dashboardId);
    for (const group of detail.groups) {
      const match = group.metrics.find(c => c.id === cardId) ?? group.charts.find(c => c.id === cardId);
      if (match) return match.name;
    }
    throw new HttpError(404, "Dashboard card not found", "NOT_FOUND");
  }
  if (objectType === AGENT_SESSION) {
    const session = await assistantStore.session(primaryKey, owner);
    return cleanSessionDisplayTitle(session.title, tForLocale(language, "panels.agentSession.untitled"));
  }
  if (objectType.startsWith("platform:")) {
    throw new HttpError(400, `Type '${objectType}' cannot be favorited`, "FAVORITE_TYPE_UNSUPPORTED");
  }
  const resolved = await resolveCustomerObjectTitle(owner, credentials, objectType, primaryKey, suppliedTitle);
  if (!resolved.available) {
    throw new HttpError(404, "Object not found or unavailable", "NOT_FOUND");
  }
  return suppliedTitle?.trim() || resolved.title;
}

async function resolveFavoriteDisplayLabel(host: PanelOperationHost, objectType: string, primaryKey: string): Promise<string> {
  try {
    return await resolveTargetNameAndVerify(host, objectType, primaryKey);
  } catch {
    return primaryKey;
  }
}

export const favoriteServerOperations: readonly PanelWriteServerOperation[] = [
  {
    handlerRef: ADD_FAVORITE,
    labelKey: "panels.favorite.add",
    kind: "action",
    binding: { kind: "PlatformOperation", id: ADD_FAVORITE },
    effect: "write",
    batch: false,
    targetTypes: FAVORITE_TARGET_TYPES,
    targetInput: "target",
    targetSchema: favoriteTargetSchema,
    inputSchema: addInputSchema,
    resultSchema: addResultSchema,
    async targetLabel(host, { objectType, primaryKey }) {
      return resolveFavoriteDisplayLabel(host, objectType, primaryKey);
    },
    done(host, name) {
      return tForLocale(host.locale, "panels.favorite.added", { name });
    },
    async execute(host: PanelOperationHost, target, input): Promise<SinglePanelOperationOutcome> {
      const { objectType, primaryKey } = favoriteTargetSchema.parse(target);
      const parsed = addInputSchema.parse(input);
      try {
        const title = await resolveTargetNameAndVerify(host, objectType, primaryKey, parsed.title);
        await addFavoriteTarget(host.executor.owner, { objectType, primaryKey, title });
        return {
          kind: "success",
          data: { favorited: true },
          affected: favoriteAffected(objectType, primaryKey),
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "FAVORITE_REFUSED", message: error.message };
      }
    },
  },
  {
    handlerRef: REMOVE_FAVORITE,
    labelKey: "panels.favorite.remove",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REMOVE_FAVORITE },
    effect: "write",
    batch: false,
    targetTypes: FAVORITE_TARGET_TYPES,
    targetInput: "target",
    targetSchema: favoriteTargetSchema,
    inputSchema: emptyInputSchema,
    resultSchema: removeResultSchema,
    async targetLabel(host, { objectType, primaryKey }) {
      return resolveFavoriteDisplayLabel(host, objectType, primaryKey);
    },
    done(host, name) {
      return tForLocale(host.locale, "panels.favorite.removed", { name });
    },
    async execute(host: PanelOperationHost, target): Promise<SinglePanelOperationOutcome> {
      const { objectType, primaryKey } = favoriteTargetSchema.parse(target);
      await removeFavoriteTarget(host.executor.owner, { objectType, primaryKey });
      return {
        kind: "success",
        data: { favorited: false },
        affected: favoriteAffected(objectType, primaryKey),
      };
    },
  },
  {
    handlerRef: MOVE_FAVORITE,
    labelKey: "panels.favorite.move",
    kind: "action",
    binding: { kind: "PlatformOperation", id: MOVE_FAVORITE },
    effect: "write",
    batch: false,
    targetTypes: FAVORITE_TARGET_TYPES,
    targetInput: "target",
    targetSchema: favoriteTargetSchema,
    inputSchema: moveInputSchema,
    resultSchema: moveResultSchema,
    async targetLabel(host, { objectType, primaryKey }) {
      return resolveFavoriteDisplayLabel(host, objectType, primaryKey);
    },
    async execute(host: PanelOperationHost, target, input): Promise<SinglePanelOperationOutcome> {
      const { objectType, primaryKey } = favoriteTargetSchema.parse(target);
      const { direction } = moveInputSchema.parse(input);
      await moveFavoriteTarget(host.executor.owner, { objectType, primaryKey }, direction);
      return {
        kind: "success",
        data: { moved: true },
        affected: favoriteAffected(objectType, primaryKey),
      };
    },
  },
];


export const favoriteDataReadRegistrations: RegisteredDataReadRegistration[] = [
  {
    typeId: FAVORITE, method: "list",
    async plan(context) {
      const ownerRead = preparePersonalFavoriteRead(context.owner, context.credentials, context.selection, context.params);
      if (ownerRead) return ownerReadPlan(ownerRead);
      const facts = await prepareFavoriteObjectRead(context.owner, context.selection, context.params, context.credentials.locale);
      if (facts) return ownerFactsPlan(facts);
      return {
        reads: [{ call: defaultRegisteredJavaCall(context) }],
        present: results => readyPayload(results[0]).payload,
      };
    },
  },
  localReadRegistration(FAVORITE, "status", {
    read: (owner, _ranges, _facts, credentials, _key, params) => createFavoriteReadAdapter(owner, credentials)
      .status(params as Parameters<ReturnType<typeof createFavoriteReadAdapter>["status"]>[0]),
  }),
  localReadRegistration(FAVORITE, "dashboardCardsStatus", {
    read: (owner, _ranges, _facts, credentials) => createFavoriteReadAdapter(owner, credentials).dashboardCardsStatus(),
  }),
];
