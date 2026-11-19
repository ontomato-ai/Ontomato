import {HttpError} from '../../utils/errors';
import type {ProductOwner} from '../product-governance/grants';
import {productGrantIdsForOwner,registerProductResource} from '../product-governance/grants';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {AsyncLocalStorage} from 'node:async_hooks';
const accessContext=new AsyncLocalStorage<{domainId:string;userId:string;use:Set<string>;edit:Set<string>}>();
export async function withProductGrants<T>(owner:ProductOwner,action:()=>Promise<T>):Promise<T>{
  const current=accessContext.getStore();
  if(current?.domainId===owner.domainId&&current.userId===owner.userId)return action();
  await migrateProductGrants(owner);
  const [use,edit]=await Promise.all([productGrantIdsForOwner(owner,'use'),productGrantIdsForOwner(owner,'edit')]);
  return accessContext.run({domainId:owner.domainId,userId:owner.userId,use:new Set(use),edit:new Set(edit)},action);
}
export async function refreshProductGrants(owner:ProductOwner){
  const access=currentProductGrants(owner);
  const [use,edit]=await Promise.all([productGrantIdsForOwner(owner,'use'),productGrantIdsForOwner(owner,'edit')]);
  access.use=new Set(use);access.edit=new Set(edit);
}
export function currentProductGrants(owner:ProductOwner){
  const access=accessContext.getStore();
  if(!access||access.domainId!==owner.domainId||access.userId!==owner.userId)throw new HttpError(503,'Product Grant context is required','PRODUCT_GOVERNANCE_UNAVAILABLE');
  return access;
}
export async function requireProductUse(owner:ProductOwner,id:string){
  return withProductGrants(owner,async()=>{if(!currentProductGrants(owner).use.has(id))throw new HttpError(403,'Product use Grant required','PRODUCT_FORBIDDEN');});
}

/** Import once, preserving revocations on every subsequent read. */
export async function migrateProductGrants(owner:ProductOwner){
  const rows=await getPostgresPool().query(`SELECT id,owner_id,visibility FROM ${t('product_assets')} WHERE domain_id=$1 AND NOT governance_registered ORDER BY id`,[owner.domainId]);
  for(const row of rows.rows){
    await registerProductResource({domainId:owner.domainId,userId:row.owner_id},row.id,row.visibility==='domain');
    await getPostgresPool().query(`UPDATE ${t('product_assets')} SET governance_registered=true WHERE domain_id=$1 AND id=$2 AND owner_id=$3`,[owner.domainId,row.id,row.owner_id]);
  }
}
