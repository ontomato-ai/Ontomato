import {qualifiedTable as t} from '../../infrastructure/postgres';
import {transaction} from '../../infrastructure/postgres-transaction';
import {lockSessionClaim} from '../agent-host/session-claim';
import {HttpError} from '../../utils/errors';
import type {ProductOwner} from './store';

export async function bindProfileSession(owner:ProductOwner,sessionId:string,profileId:string,releaseId:string,contextObjects:{className:string;primaryKey:string}[]=[],pageState:Record<string,unknown>={}){
  return transaction(async client=>{
  await lockSessionClaim(client,sessionId);
  const session=await client.query(`SELECT id FROM ${t('assistant_sessions')} WHERE domain_id=$1 AND owner_id=$2 AND id=$3`,[owner.domainId,owner.userId,sessionId]);
  if(!session.rows.length)throw new HttpError(404,'Conversation unavailable','NOT_FOUND');
   const saved=await client.query(`INSERT INTO ${t('product_profile_sessions')} (domain_id,session_id,profile_id,release_id,context_objects,page_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT(domain_id,session_id) DO UPDATE SET session_id=EXCLUDED.session_id WHERE ${t('product_profile_sessions')}.profile_id=EXCLUDED.profile_id AND ${t('product_profile_sessions')}.release_id=EXCLUDED.release_id AND ${t('product_profile_sessions')}.context_objects=EXCLUDED.context_objects AND ${t('product_profile_sessions')}.page_state=EXCLUDED.page_state RETURNING session_id`,[owner.domainId,sessionId,profileId,releaseId,JSON.stringify(contextObjects),JSON.stringify(pageState)]);
  if(!saved.rows.length)throw new HttpError(409,'Session already belongs to another Profile release','IDEMPOTENCY_CONFLICT');
  });
}
