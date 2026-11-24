import type { AppBuilderBootstrap } from "@ontomato/contracts/app-builder";
import { assistantStore, type AssistantOwner } from "../assistant/store";

export async function appBuilderBootstrap(owner: AssistantOwner): Promise<AppBuilderBootstrap> {
  const { id, name, description, icon, enabled } = await assistantStore.appBuilder(owner.domainId);
  const agent = { id, name, description, icon, enabled };
  return { agent, agents: [agent] };
}
