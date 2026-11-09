import type { AppBuilderBootstrap } from "@ontomato/contracts/app-builder";
import { assistantStore, type AssistantOwner } from "../assistant/store";

export async function appBuilderBootstrap(owner: AssistantOwner): Promise<AppBuilderBootstrap> {
  const agent = await assistantStore.appBuilder(owner.domainId);
  return { agent: { id: agent.id, name: agent.name, description: agent.description, icon: agent.icon, enabled: agent.enabled } };
}
