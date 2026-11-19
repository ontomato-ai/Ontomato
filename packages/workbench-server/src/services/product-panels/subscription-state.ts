import type {ProductSubscriptionTarget,ProductSubscriptionEvent} from '@ontomato/contracts/product-subscriptions';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';

export type Subscription={id:string;owner:ProductOwner;credentials:AssistantCredentials;target:ProductSubscriptionTarget;expiresAt:number;fingerprint?:string;members?:Set<string>;events:ProductSubscriptionEvent[];busy:boolean;evaluation?:Promise<void>};
export const subscriptions=new Map<string,Subscription>();
export async function checkpoint(subscription:Subscription){
  if(subscriptions.get(subscription.id)!==subscription)return;
  await getPostgresPool().query(`INSERT INTO ${t('product_subscriptions')} (domain_id,principal_id,id,target,expires_at,state) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(domain_id,principal_id,id) DO UPDATE SET expires_at=EXCLUDED.expires_at,state=EXCLUDED.state`,[subscription.owner.domainId,subscription.owner.userId,subscription.id,JSON.stringify(subscription.target),new Date(subscription.expiresAt),JSON.stringify({fingerprint:subscription.fingerprint,members:[...subscription.members??[]],events:subscription.events})]);
}
export async function removeCheckpoint(subscription:Subscription){await getPostgresPool().query(`DELETE FROM ${t('product_subscriptions')} WHERE domain_id=$1 AND principal_id=$2 AND id=$3`,[subscription.owner.domainId,subscription.owner.userId,subscription.id]);}
