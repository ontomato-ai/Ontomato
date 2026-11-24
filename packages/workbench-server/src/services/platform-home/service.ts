import type {
  HomeApplicationOpened,
  HomeDashboards,
  HomeFavorites,
  HomeItemRef,
  HomeState,
} from "@ontomato/contracts/platform-home";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { readCurrentPanel, requireCurrentProduct } from "../product-panels/current";

const favoriteKey = (item: Pick<HomeItemRef, "kind" | "id">) => `${item.kind}:${item.id}`;

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
