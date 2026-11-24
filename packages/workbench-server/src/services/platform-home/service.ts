import {
  homePinnedObjectSchema,
  homePinnedObjectsSchema,
  type HomeApplicationOpened,
  type HomeDashboards,
  type HomeFavorites,
  type HomeItemRef,
  type HomePinnedObject,
  type HomePinnedObjects,
  type HomeState,
} from "@ontomato/contracts/platform-home";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { readCurrentPanel, requireCurrentProduct } from "../product-panels/current";

const favoriteKey = (item: Pick<HomeItemRef, "kind" | "id">) => `${item.kind}:${item.id}`;
const pinnedObjectKey = (item: Pick<HomePinnedObject, "className" | "primaryKey">) =>
  JSON.stringify([item.className, item.primaryKey]);

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
