import type { AppBuilderBootstrap } from "@ontomato/contracts/app-builder";
import { assistantStore, type AssistantOwner } from "../assistant/store";
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';

export async function appBuilderBootstrap(owner: AssistantOwner): Promise<AppBuilderBootstrap> {
  const agent = await assistantStore.appBuilder(owner.domainId);
  const rows=(await getPostgresPool().query(`SELECT id,name,description,icon,enabled FROM ${t('assistant_agents')} WHERE domain_id=$1 AND (kind='app-builder' OR kind LIKE 'app-builder:%') ORDER BY sort_order,name,id`,[owner.domainId])).rows;
  return { agent: { id: agent.id, name: agent.name, description: agent.description, icon: agent.icon, enabled: agent.enabled },agents:rows };
}
