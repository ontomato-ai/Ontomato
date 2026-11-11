import type {
  HomeApplicationOpened,
  HomeDashboards,
  HomeFavorites,
  HomeItemRef,
  HomeState,
} from "@ontomato/contracts/platform-home";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";

export async function readHome(owner: PlatformHomeOwner): Promise<HomeState> {
  const [preferences, recentApplications, recentAgents] = await Promise.all([
    platformHomeStore.preferences(owner),
    platformHomeStore.recentApplications(owner),
    assistantStore.recentAgentConversations(owner),
  ]);
  return { ...preferences, recentApplications, recentAgents };
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
