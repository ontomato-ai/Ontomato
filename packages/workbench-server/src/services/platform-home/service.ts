import type {
  HomeApplicationOpened,
  HomeDashboards,
  HomeFavorites,
  HomeItemRef,
  HomeState,
} from "@ontomato/contracts/platform-home";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";
import { personalHome, saveHomeWorkspace } from "../product-assets/store";
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';

export async function readHome(owner: PlatformHomeOwner,credentials:AssistantCredentials={}): Promise<HomeState> {
  const [preferences, recentApplications, recentConversations] = await Promise.all([
    personalHome(owner,credentials).then(home => {
      if(home.document.kind !== "page") throw new Error("Home must be a page");
      return {favorites:[...home.document.workspace.applicationIds.map(id=>({kind:"application" as const,id})),...home.document.workspace.agentIds.map(id=>({kind:"agent" as const,id}))],dashboardIds:home.document.workspace.dashboardIds};
    }),
    platformHomeStore.recentApplications(owner),
    assistantStore.recentConversations(owner),
  ]);
  return { ...preferences, recentApplications, recentConversations };
}

export async function saveFavorites(
  owner: PlatformHomeOwner,
  items: HomeItemRef[],
  credentials:AssistantCredentials={},
): Promise<HomeFavorites> {
  const home=await personalHome(owner,credentials);
  if(home.document.kind !== "page") throw new Error("Home must be a page");
  await saveHomeWorkspace(owner,{...home.document.workspace,applicationIds:items.filter(item=>item.kind==="application").map(item=>item.id),agentIds:items.filter(item=>item.kind==="agent").map(item=>item.id)},home.revision,credentials);
  return { items };
}

export async function saveDashboards(
  owner: PlatformHomeOwner,
  ids: string[],
  credentials:AssistantCredentials={},
): Promise<HomeDashboards> {
  const home=await personalHome(owner,credentials);
  if(home.document.kind !== "page") throw new Error("Home must be a page");
  await saveHomeWorkspace(owner,{...home.document.workspace,dashboardIds:ids},home.revision,credentials);
  return { ids };
}

export async function recordApplicationOpen(
  owner: PlatformHomeOwner,
  applicationId: string,
): Promise<HomeApplicationOpened> {
  return platformHomeStore.recordApplicationOpen(owner, applicationId);
}
