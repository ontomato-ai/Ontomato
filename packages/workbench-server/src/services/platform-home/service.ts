import type {
  HomeApplicationOpened,
  HomeDashboards,
  HomeFavorites,
  HomeItemRef,
  HomeState,
} from "@ontomato/contracts/platform-home";
import { assistantStore } from "../assistant/store";
import { platformHomeStore, type PlatformHomeOwner } from "./store";
import { personalHome, saveHomeWorkspace,readProductOverlay } from "../product-assets/store";
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';

export async function readHome(owner: PlatformHomeOwner,credentials:AssistantCredentials={}): Promise<HomeState> {
  const [preferences, recentApplications, recentConversations] = await Promise.all([
    personalHome(owner,credentials).then(async home => {
      if(home.document.kind !== "page") throw new Error("Home must be a page");
      const workspace=(await readProductOverlay(owner,home.id)).workspace??home.document.workspace??defaultPersonalWorkspace();
      return {favorites:[...workspace.applicationIds.map(id=>({kind:"application" as const,id})),...workspace.agentIds.map(id=>({kind:"agent" as const,id}))],dashboardIds:workspace.dashboardIds};
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
  const workspace=(await readProductOverlay(owner,home.id)).workspace??home.document.workspace??defaultPersonalWorkspace();
  await saveHomeWorkspace(owner,{...workspace,applicationIds:items.filter(item=>item.kind==="application").map(item=>item.id),agentIds:items.filter(item=>item.kind==="agent").map(item=>item.id)},home.revision,credentials);
  return { items };
}

export async function saveDashboards(
  owner: PlatformHomeOwner,
  ids: string[],
  credentials:AssistantCredentials={},
): Promise<HomeDashboards> {
  const home=await personalHome(owner,credentials);
  if(home.document.kind !== "page") throw new Error("Home must be a page");
  const workspace=(await readProductOverlay(owner,home.id)).workspace??home.document.workspace??defaultPersonalWorkspace();
  await saveHomeWorkspace(owner,{...workspace,dashboardIds:ids},home.revision,credentials);
  return { ids };
}

export async function recordApplicationOpen(
  owner: PlatformHomeOwner,
  applicationId: string,
): Promise<HomeApplicationOpened> {
  return platformHomeStore.recordApplicationOpen(owner, applicationId);
}
