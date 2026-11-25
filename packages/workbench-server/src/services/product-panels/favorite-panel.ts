import { z } from "zod";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { dashboardCardPrimaryKey, parseDashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import type { PanelOperationTargetTypes } from "@ontomato/contracts/panel-operations";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  favoriteMoveDirectionSchema,
  favoriteTargetGroupSchema,
  type FavoriteTargetGroup,
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
  removeFavoriteTarget,
} from "../platform-home/service";
import { createCustomerOntologyReadAdapter } from "../ontology-model/customer-reads";
import type { ProductOwner } from "../product-governance/grants";
import { cleanSessionDisplayTitle, formatShortDateTime, sessionOpenPath } from "./agent-session-panel";
import { applicationCatalogueClient } from "./application-catalogue";
import type { PanelOperationHost, PanelWriteServerOperation, SinglePanelOperationOutcome } from "./server-operations";

export const FAVORITE_TARGET_TYPES: PanelOperationTargetTypes = {
  platformTypes: [APPLICATION, AGENT_DEFINITION, DASHBOARD, DASHBOARD_CARD, AGENT_SESSION],
  customerObjects: true,
};

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
  if (isPanelApplication(app) || app.kind === "hosted" || app.kind === "connected") return applicationRootPath(app.id);
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

async function resolveCustomerObjectTitle(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  className: string,
  primaryKey: string,
  fallback?: string,
): Promise<{ title: string; available: boolean }> {
  try {
    const record = await createCustomerOntologyReadAdapter(owner, viewer).record(className, primaryKey);
    const label = record.label?.trim();
    if (label) return { title: label, available: true };
    return { title: fallback?.trim() || primaryKey, available: true };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
      return { title: fallback?.trim() || primaryKey, available: false };
    }
    return { title: fallback?.trim() || primaryKey, available: true };
  }
}

export function createFavoriteReadAdapter(owner: ProductOwner, viewer: AssistantCredentials) {
  const language = resolveLocale(viewer.locale);
  const unavailableLabel = favoriteText(viewer.locale, "unavailable");
  const untitledSession = tForLocale(viewer.locale, "panels.agentSession.untitled");
  const fieldLabels = {
    className: favoriteText(viewer.locale, "className"),
    primaryKey: favoriteText(viewer.locale, "primaryKey"),
    title: favoriteText(viewer.locale, "title"),
  };

  return {
    async list(params: { targetGroup?: FavoriteTargetGroup } = {}): Promise<PanelRecord[]> {
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
        needApps ? applicationCatalogueClient(viewer).navigation().catch(() => []) : Promise.resolve([]),
        needAgents
          ? import("../assistant/service").then(({ assistantService }) => assistantService.agents(owner, viewer).then(r => r.agents)).catch(() => [])
          : Promise.resolve([]),
        needDashboards || needDashboardCards ? listDashboards(owner.userId, owner.domainId).catch(() => []) : Promise.resolve([]),
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
                icon: "sparkles",
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
        const boardDetails = new Map<string, Awaited<ReturnType<typeof getOwnedDashboard>> | null>();
        await Promise.all(state.dashboardIds.map(async dashboardId => {
          try {
            boardDetails.set(dashboardId, await getOwnedDashboard(owner.userId, owner.domainId, dashboardId));
          } catch {
            boardDetails.set(dashboardId, null);
          }
        }));
        for (const dashboardId of state.dashboardIds) {
          const detail = boardDetails.get(dashboardId);
          if (!detail) continue;
          const allCards = detail.groups.flatMap(g => [
            ...g.metrics.map(card => ({
              id: card.id,
              name: card.name,
              kind: "metric" as const,
              valueField: card.valueField,
              unit: card.unit,
              formats: card.formats,
            })),
            ...g.charts.map(card => ({
              id: card.id,
              name: card.name,
              kind: "chart" as const,
              valueField: undefined,
              unit: undefined,
              formats: undefined,
            })),
          ]);
          const cardsById = new Map(allCards.map(c => [c.id, c]));
          const chosenIds = state.dashboardCards[dashboardId]?.length
            ? state.dashboardCards[dashboardId]!
            : allCards.map(c => c.id);
          chosenIds.forEach((cardId, index) => {
            const card = cardsById.get(cardId);
            const available = Boolean(card);
            const pk = dashboardCardPrimaryKey({ dashboardId, cardId });
            rows.push({
              className: DASHBOARD_CARD,
              primaryKey: pk,
              label: available ? card!.name : unavailableLabel,
              subtitle: detail.name,
              fields: {
                className: DASHBOARD_CARD,
                primaryKey: pk,
                dashboardId,
                dashboardName: detail.name,
                cardId,
                kind: card?.kind ?? "metric",
                title: available ? card!.name : unavailableLabel,
                ...(card?.valueField ? { valueField: card.valueField } : {}),
                ...(card?.unit ? { unit: card.unit } : {}),
                ...(card?.formats ? { formats: { kind: "json", value: card.formats } } : {}),
                favorite: true,
                canMoveUp: index > 0,
                canMoveDown: index < chosenIds.length - 1,
                unavailable: !available,
              },
              fieldLabels,
              outputs: {
                openPath: available ? dashboardOpenPath(dashboardId, cardId) : "",
                favorited: true,
                canMoveUp: index > 0,
                canMoveDown: index < chosenIds.length - 1,
                unavailable: !available,
              },
            });
          });
        }
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
        state.pinnedObjects.forEach((item, index) => {
          const resolved = resolvedObjects[index]!;
          rows.push({
            className: item.className,
            primaryKey: item.primaryKey,
            label: resolved.available ? resolved.title : unavailableLabel,
            subtitle: item.className,
            fields: {
              className: item.className,
              primaryKey: item.primaryKey,
              title: resolved.available ? resolved.title : unavailableLabel,
              favorite: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.pinnedObjects.length - 1,
              unavailable: !resolved.available,
            },
            fieldLabels,
            outputs: {
              openPath: resolved.available ? customerObjectOpenPath(item.className, item.primaryKey) : "",
              favorited: true,
              canMoveUp: index > 0,
              canMoveDown: index < state.pinnedObjects.length - 1,
              unavailable: !resolved.available,
            },
          });
        });
      }

      return rows;
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
