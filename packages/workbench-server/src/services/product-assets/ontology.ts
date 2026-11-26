import {z} from 'zod';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {productGraphSchema} from '@ontomato/contracts/product-graph';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {backendPost} from '../../utils/backend-client';
import {environment} from '../../config/environment';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readProductGrantRecords} from '../product-governance/grants';
import type {readProductAssetGraph} from '../product-panels/asset-graph-read';

export function ontologyRegistration(asset:ProductAsset){
  const document=asset.document;
  if('renders' in document)return {id:asset.id,kind:document.kind,name:asset.name,revision:asset.revision,targetKind:document.renders.kind,targetId:document.renders.id,isDefault:document.isDefault};
  if(document.kind==='application')return {id:asset.id,kind:document.kind,name:asset.name,revision:asset.revision,targetKind:null,targetId:null,isDefault:false};
  return null;
}
async function request(operation:string,body:unknown){
  const token=environment.agentRuntime().queryServiceToken;
  if(!token)throw new HttpError(503,'Ontology registration service credential unavailable','PRODUCT_ONTOLOGY_UNAVAILABLE');
  const response=await backendPost('product-ontology-'+operation,config.dataQuery.baseUrl+'/ontology/products/service/'+operation,body,{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});
  return JSON.parse(response.text);
}
/** An outbox commits with the product document; failed remote synchronization remains retryable. */
export async function synchronizeProductOntology(owner:ProductOwner){
  const rows=await getPostgresPool().query(`SELECT asset_id,revision,registration FROM ${t('product_ontology_outbox')} WHERE domain_id=$1 ORDER BY asset_id`,[owner.domainId]);
  for(const row of rows.rows){
    const result=row.registration?await request('register',{domainId:owner.domainId,nodes:[row.registration]}):await request('remove',{domainId:owner.domainId,id:row.asset_id,revision:row.revision});
    if(result.success!==true)throw new HttpError(503,'Product ontology synchronization failed','PRODUCT_ONTOLOGY_UNAVAILABLE');
    await getPostgresPool().query(`UPDATE ${t('product_assets')} SET ontology_registered_revision=$3 WHERE domain_id=$1 AND id=$2 AND revision=$3`,[owner.domainId,row.asset_id,row.revision]);
    await getPostgresPool().query(`DELETE FROM ${t('product_ontology_outbox')} WHERE domain_id=$1 AND asset_id=$2 AND revision=$3`,[owner.domainId,row.asset_id,row.revision]);
  }
}
export const ontologyProductGraphSchema=z.object({nodes:z.array(z.object({id:z.string(),kind:z.string(),name:z.string(),revision:z.number()})),edges:z.array(z.object({source:z.string(),relation:z.enum(['renders','embodies']),target_kind:z.string(),target_id:z.string(),is_default:z.boolean()}))});
export async function readProductOntology(owner:ProductOwner){
  const pending = await getPostgresPool().query(
    `SELECT 1 FROM ${t("product_ontology_outbox")} WHERE domain_id=$1 LIMIT 1`, [owner.domainId],
  );
  if (pending.rows.length) {
    throw new HttpError(409, "Product ontology registration is not current", "PRODUCT_ONTOLOGY_PENDING");
  }
  return ontologyProductGraphSchema.parse(await request('graph',{domainId:owner.domainId,userId:owner.userId}));
}
// Authorization edges are owned by the interface-interception pack (permission module batch facts, readAuthorizationGraphFacts); replace this body wholesale.
export async function addAuthorizationEdges(
  { graph, grantableApplicationIds }: Awaited<ReturnType<typeof readProductAssetGraph>>,
  _owner: ProductOwner,
  viewer: AssistantCredentials,
) {
  for (const node of graph.nodes) {
    if (node.kind !== "application" || !grantableApplicationIds.has(node.assetId!)) continue;
    const { grants } = await readProductGrantRecords(node.assetId!, viewer).catch(() => ({ grants: [] }));
    for (const grant of grants) {
      if (grant.verb === "view") continue;
      const id = `grant:${grant.principalKind}:${grant.principalId}`;
      if (!graph.nodes.some(node => node.id === id)) {
        graph.nodes.push({ id, name: grant.principalName ?? grant.principalId, kind: grant.principalKind, category: "principal" });
      }
      if (!graph.edges.some(edge => edge.source === id && edge.target === node.id && edge.relation === grant.verb)) {
        graph.edges.push({ source: id, target: node.id, relation: grant.verb, storage: "governance" });
      }
    }
  }
  return productGraphSchema.parse(graph);
}
