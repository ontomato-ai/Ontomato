import {
  dashboardCardPrimaryKey,
  parseDashboardCardPrimaryKey,
} from "@ontomato/contracts/dashboard";
import {
  homeDashboardCardsSchema,
  homePinnedObjectSchema,
  homePinnedObjectsSchema,
  homePinnedSessionsSchema,
  type FavoriteMoveDirection,
  type HomeApplicationOpened,
  type HomeDashboardCards,
  type HomeDashboards,
  type HomeFavorites,
  type HomeItemRef,
  type HomePinnedObject,
  type HomePinnedObjects,
  type HomeState,
} from "@ontomato/contracts/platform-home";
import {
  AGENT_DEFINITION,
  AGENT_SESSION,
  APPLICATION,
  DASHBOARD,
  DASHBOARD_CARD,
} from "@ontomato/contracts/platform-object-types";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { readCurrentPanel, requireCurrentProduct } from "../product-panels/current";

const favoriteKey = (item: Pick<HomeItemRef, "kind" | "id">) => `${item.kind}:${item.id}`;
const pinnedObjectKey = (item: Pick<HomePinnedObject, "className" | "primaryKey">) =>
  JSON.stringify([item.className, item.primaryKey]);

export function favoriteTargetKey(objectType: string, primaryKey: string): string {
  return JSON.stringify([objectType, primaryKey]);
}

function reorderList<T>(items: readonly T[], index: number, direction: FavoriteMoveDirection): T[] {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved!);
  return next;
}

export async function readHomePanel(owner: PlatformHomeOwner, credentials: AssistantCredentials) {
  const homePanelId = await platformHomeStore.homePanelId(owner);
  return homePanelId === null ? null : readCurrentPanel(owner, credentials, homePanelId);
}

export async function saveHomePanel(owner: PlatformHomeOwner, credentials: AssistantCredentials, homePanelId: string | null) {
  if (homePanelId !== null)
    await requireCurrentProduct(owner, credentials, "panel", homePanelId, "use");
  await platformHomeStore.saveHomePanelId(owner, homePanelId);
}

export async function readFavorites(owner: PlatformHomeOwner): Promise<HomeItemRef[]> {
  return (await platformHomeStore.preferences(owner)).favorites;
}

export async function addHomeFavorite(owner: PlatformHomeOwner, item: HomeItemRef): Promise<HomeFavorites> {
  const current = await readFavorites(owner);
  const key = favoriteKey(item);
  if (current.some(existing => favoriteKey(existing) === key)) {
    return { items: current };
  }
  const items = [...current, item];
  await platformHomeStore.saveFavorites(owner, items);
  return { items };
}

export async function removeHomeFavorite(owner: PlatformHomeOwner, item: HomeItemRef): Promise<HomeFavorites> {
  const current = await readFavorites(owner);
  const key = favoriteKey(item);
  if (!current.some(existing => favoriteKey(existing) === key)) {
    return { items: current };
  }
  const items = current.filter(existing => favoriteKey(existing) !== key);
  await platformHomeStore.saveFavorites(owner, items);
  return { items };
}

export async function readHome(owner: PlatformHomeOwner): Promise<HomeState> {
  const [preferences, recentApplications, recentConversations] = await Promise.all([
    platformHomeStore.preferences(owner),
    platformHomeStore.recentApplications(owner),
    assistantStore.recentConversations(owner),
  ]);
  return { ...preferences, recentApplications, recentConversations };
}

export async function saveFavorites(
  owner: PlatformHomeOwner,
  items: HomeItemRef[],
): Promise<HomeFavorites> {
  await platformHomeStore.saveFavorites(owner, items);
  return { items };
}

export async function saveDashboards(
  owner: PlatformHomeOwner,
  ids: string[],
): Promise<HomeDashboards> {
  await platformHomeStore.saveDashboards(owner, ids);
  return { ids };
}

export async function recordApplicationOpen(
  owner: PlatformHomeOwner,
  applicationId: string,
): Promise<HomeApplicationOpened> {
  return platformHomeStore.recordApplicationOpen(owner, applicationId);
}

export async function readPinnedObjects(owner: PlatformHomeOwner): Promise<HomePinnedObject[]> {
  return platformHomeStore.pinnedObjects(owner);
}

export async function savePinnedObjects(
  owner: PlatformHomeOwner,
  items: HomePinnedObject[],
): Promise<HomePinnedObjects> {
  const deduped: HomePinnedObject[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const parsed = homePinnedObjectSchema.parse(raw);
    const key = pinnedObjectKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(parsed);
  }
  const validated = homePinnedObjectsSchema.shape.items.parse(deduped);
  await platformHomeStore.savePinnedObjects(owner, validated);
  return { items: validated };
}

export async function addPinnedObject(
  owner: PlatformHomeOwner,
  item: HomePinnedObject,
): Promise<HomePinnedObjects> {
  const parsed = homePinnedObjectSchema.parse(item);
  const current = await readPinnedObjects(owner);
  const key = pinnedObjectKey(parsed);
  const existingIndex = current.findIndex((existing) => pinnedObjectKey(existing) === key);
  if (existingIndex >= 0) {
    if (current[existingIndex]!.title === parsed.title) {
      return { items: current };
    }
    const items = current.map((existing, index) => (index === existingIndex ? parsed : existing));
    await platformHomeStore.savePinnedObjects(owner, items);
    return { items };
  }
  if (current.length >= 30) {
    throw new HttpError(400, "Maximum number of favorite objects reached (30).", "FAVORITE_LIMIT_REACHED");
  }
  const items = [...current, parsed];
  await platformHomeStore.savePinnedObjects(owner, items);
  return { items };
}

export async function removePinnedObject(
  owner: PlatformHomeOwner,
  target: Pick<HomePinnedObject, "className" | "primaryKey">,
): Promise<HomePinnedObjects> {
  const current = await readPinnedObjects(owner);
  const key = pinnedObjectKey(target);
  if (!current.some((existing) => pinnedObjectKey(existing) === key)) {
    return { items: current };
  }
  const items = current.filter((existing) => pinnedObjectKey(existing) !== key);
  await platformHomeStore.savePinnedObjects(owner, items);
  return { items };
}

export async function readAllFavoriteState(owner: PlatformHomeOwner) {
  return platformHomeStore.allFavoriteState(owner);
}

/** Single owner-backed lookup set of all favorited `(objectType, primaryKey)` pairs for the current user and domain. */
export async function readFavoriteKeySet(owner: PlatformHomeOwner): Promise<Set<string>> {
  const state = await platformHomeStore.allFavoriteState(owner);
  const keys = new Set<string>();
  for (const item of state.favorites) {
    keys.add(favoriteTargetKey(item.kind === "application" ? APPLICATION : AGENT_DEFINITION, item.id));
  }
  for (const dashboardId of state.dashboardIds) {
    keys.add(favoriteTargetKey(DASHBOARD, dashboardId));
  }
  for (const [dashboardId, cardIds] of Object.entries(state.dashboardCards)) {
    for (const cardId of cardIds) {
      keys.add(favoriteTargetKey(DASHBOARD_CARD, dashboardCardPrimaryKey({ dashboardId, cardId })));
    }
  }
  for (const sessionId of state.pinnedSessions) {
    keys.add(favoriteTargetKey(AGENT_SESSION, sessionId));
  }
  for (const pinned of state.pinnedObjects) {
    keys.add(favoriteTargetKey(pinned.className, pinned.primaryKey));
  }
  return keys;
}

export async function isFavoriteTarget(owner: PlatformHomeOwner, objectType: string, primaryKey: string): Promise<boolean> {
  const keys = await readFavoriteKeySet(owner);
  return keys.has(favoriteTargetKey(objectType, primaryKey));
}

export async function addFavoriteTarget(
  owner: PlatformHomeOwner,
  target: { objectType: string; primaryKey: string; title?: string },
): Promise<void> {
  const { objectType, primaryKey } = target;
  if (objectType === APPLICATION) {
    await addHomeFavorite(owner, { kind: "application", id: primaryKey });
    return;
  }
  if (objectType === AGENT_DEFINITION) {
    await addHomeFavorite(owner, { kind: "agent", id: primaryKey });
    return;
  }
  if (objectType === DASHBOARD) {
    const current = (await platformHomeStore.preferences(owner)).dashboardIds;
    if (!current.includes(primaryKey)) {
      await platformHomeStore.saveDashboards(owner, [...current, primaryKey]);
    }
    return;
  }
  if (objectType === DASHBOARD_CARD) {
    const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
    const [prefs, cards] = await Promise.all([
      platformHomeStore.preferences(owner),
      platformHomeStore.dashboardCards(owner),
    ]);
    if (!prefs.dashboardIds.includes(dashboardId)) {
      await platformHomeStore.saveDashboards(owner, [...prefs.dashboardIds, dashboardId]);
    }
    const existing = cards[dashboardId] ?? [];
    if (!existing.includes(cardId)) {
      await platformHomeStore.saveDashboardCards(owner, {
        ...cards,
        [dashboardId]: [...existing, cardId],
      });
    }
    return;
  }
  if (objectType === AGENT_SESSION) {
    const current = await platformHomeStore.pinnedSessions(owner);
    if (current.includes(primaryKey)) return;
    if (current.length >= 20) {
      throw new HttpError(400, "Maximum number of pinned sessions reached (20).", "FAVORITE_LIMIT_REACHED");
    }
    await platformHomeStore.savePinnedSessions(owner, homePinnedSessionsSchema.parse([...current, primaryKey]));
    return;
  }
  if (objectType.startsWith("platform:")) {
    throw new HttpError(400, `Type '${objectType}' cannot be added to personal favorites`, "FAVORITE_TYPE_UNSUPPORTED");
  }
  const title = target.title?.trim() || primaryKey;
  await addPinnedObject(owner, { className: objectType, primaryKey, title: title.slice(0, 200) });
}

export async function removeFavoriteTarget(
  owner: PlatformHomeOwner,
  target: { objectType: string; primaryKey: string },
): Promise<void> {
  const { objectType, primaryKey } = target;
  if (objectType === APPLICATION) {
    await removeHomeFavorite(owner, { kind: "application", id: primaryKey });
    return;
  }
  if (objectType === AGENT_DEFINITION) {
    await removeHomeFavorite(owner, { kind: "agent", id: primaryKey });
    return;
  }
  if (objectType === DASHBOARD) {
    const [prefs, cards] = await Promise.all([
      platformHomeStore.preferences(owner),
      platformHomeStore.dashboardCards(owner),
    ]);
    if (prefs.dashboardIds.includes(primaryKey)) {
      await platformHomeStore.saveDashboards(owner, prefs.dashboardIds.filter(id => id !== primaryKey));
    }
    if (Object.hasOwn(cards, primaryKey)) {
      const nextCards: HomeDashboardCards = { ...cards };
      delete nextCards[primaryKey];
      await platformHomeStore.saveDashboardCards(owner, homeDashboardCardsSchema.parse(nextCards));
    }
    return;
  }
  if (objectType === DASHBOARD_CARD) {
    const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
    const cards = await platformHomeStore.dashboardCards(owner);
    const existing = cards[dashboardId];
    if (existing && existing.includes(cardId)) {
      const nextList = existing.filter(id => id !== cardId);
      const nextCards: HomeDashboardCards = { ...cards };
      if (nextList.length > 0) nextCards[dashboardId] = nextList;
      else delete nextCards[dashboardId];
      await platformHomeStore.saveDashboardCards(owner, homeDashboardCardsSchema.parse(nextCards));
    }
    return;
  }
  if (objectType === AGENT_SESSION) {
    const current = await platformHomeStore.pinnedSessions(owner);
    if (current.includes(primaryKey)) {
      await platformHomeStore.savePinnedSessions(owner, current.filter(id => id !== primaryKey));
    }
    return;
  }
  if (objectType.startsWith("platform:")) {
    throw new HttpError(400, `Type '${objectType}' cannot be removed from personal favorites`, "FAVORITE_TYPE_UNSUPPORTED");
  }
  await removePinnedObject(owner, { className: objectType, primaryKey });
}

export async function moveFavoriteTarget(
  owner: PlatformHomeOwner,
  target: { objectType: string; primaryKey: string },
  direction: FavoriteMoveDirection,
): Promise<void> {
  const { objectType, primaryKey } = target;
  if (objectType === APPLICATION || objectType === AGENT_DEFINITION) {
    const kind = objectType === APPLICATION ? "application" : "agent";
    const current = await readFavorites(owner);
    const index = current.findIndex(item => item.kind === kind && item.id === primaryKey);
    if (index < 0) return;
    await platformHomeStore.saveFavorites(owner, reorderList(current, index, direction));
    return;
  }
  if (objectType === DASHBOARD) {
    const current = (await platformHomeStore.preferences(owner)).dashboardIds;
    const index = current.indexOf(primaryKey);
    if (index < 0) return;
    await platformHomeStore.saveDashboards(owner, reorderList(current, index, direction));
    return;
  }
  if (objectType === DASHBOARD_CARD) {
    const { dashboardId, cardId } = parseDashboardCardPrimaryKey(primaryKey);
    const cards = await platformHomeStore.dashboardCards(owner);
    const current = cards[dashboardId];
    if (!current) return;
    const index = current.indexOf(cardId);
    if (index < 0) return;
    await platformHomeStore.saveDashboardCards(owner, { ...cards, [dashboardId]: reorderList(current, index, direction) });
    return;
  }
  if (objectType === AGENT_SESSION) {
    const current = await platformHomeStore.pinnedSessions(owner);
    const index = current.indexOf(primaryKey);
    if (index < 0) return;
    await platformHomeStore.savePinnedSessions(owner, reorderList(current, index, direction));
    return;
  }
  if (objectType.startsWith("platform:")) {
    throw new HttpError(400, `Type '${objectType}' cannot be reordered in personal favorites`, "FAVORITE_TYPE_UNSUPPORTED");
  }
  const current = await readPinnedObjects(owner);
  const key = pinnedObjectKey({ className: objectType, primaryKey });
  const index = current.findIndex(item => pinnedObjectKey(item) === key);
  if (index < 0) return;
  await platformHomeStore.savePinnedObjects(owner, reorderList(current, index, direction));
}
