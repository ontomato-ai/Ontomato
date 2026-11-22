import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {modelSelectionSchema,type ModelSelection} from '@ontomato/contracts/model-settings';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {validateModelSelection} from '../../platform/agent-runtime/model-selection';
import {assistantStore,type AssistantOwner} from '../assistant/store';
import {APP_BUILDER,isAppBuilderKind} from './definition';
import {HttpError} from '../../utils/errors';

export const builderAgentName = z.string().trim().min(1).max(200);
export const builderAgentCreateSchema = z.object({name:builderAgentName,modelSelection:modelSelectionSchema.default({modelId:null})}).strict();
const builderModelRecord = z.object({id:z.string().uuid(),name:z.string(),modelSelection:modelSelectionSchema});

export async function listBuilderAgents(owner:AssistantOwner){
  await assistantStore.appBuilder(owner.domainId);
  return builderModelRecord.array().parse((await getPostgresPool().query(`SELECT id,name,model_selection AS "modelSelection" FROM ${t('assistant_agents')} WHERE domain_id=$1 AND (kind='app-builder' OR kind LIKE 'app-builder:%') ORDER BY sort_order,name,id`,[owner.domainId])).rows);
}
export async function readBuilderAgent(owner: AssistantOwner, id: string) {
  const agent = await assistantStore.agent(id, owner);
  if (!isAppBuilderKind(agent.kind)) throw new HttpError(404, "App builder unavailable", "NOT_FOUND");
  return builderModelRecord.parse({ id: agent.id, name: agent.name, modelSelection: agent.model_selection });
}

export async function createBuilderAgent(owner:AssistantOwner,input:{name:string;modelSelection:ModelSelection},id: string = randomUUID()){
  await validateModelSelection(owner.domainId,input.modelSelection);
  const inserted = await getPostgresPool().query(`INSERT INTO ${t('assistant_agents')}(id,domain_id,kind,name,description,model_selection,skills) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,[id,owner.domainId,'app-builder:'+id,input.name,APP_BUILDER.description,JSON.stringify(input.modelSelection),JSON.stringify(APP_BUILDER.skills)]);
  if (!inserted.rowCount) {
    const row = (await getPostgresPool().query(
      `SELECT domain_id, kind FROM ${t("assistant_agents")} WHERE id=$1`, [id],
    )).rows[0];
    if (row?.domain_id !== owner.domainId || row.kind !== `app-builder:${id}`)
      throw new HttpError(409, "Idempotency key reused", "IDEMPOTENCY_CONFLICT");
  }
  return {id};
}
export async function saveBuilderModel(owner:AssistantOwner,id:string,selection:ModelSelection){
  await readBuilderAgent(owner,id);
  await validateModelSelection(owner.domainId,selection);
  await getPostgresPool().query(`UPDATE ${t('assistant_agents')} SET model_selection=$3,model_reference_migrated=true WHERE domain_id=$1 AND id=$2`,[owner.domainId,id,JSON.stringify(selection)]);
  return {modelSelection:selection};
}
