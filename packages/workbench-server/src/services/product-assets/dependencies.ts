import { productDependencies } from '@ontomato/contracts/product-dependencies';
import type { ProductAsset, ProductReference } from '@ontomato/contracts/product-assets';
import { objectViewDocumentSchema } from '@ontomato/contracts/object-views';
import { getOwnedDashboard } from '../dashboard/access';
import { backendPost, buildBackendHeaders } from '../../utils/backend-client';
import { config } from '../../config/application';
import type { AssistantCredentials } from '../../platform/agent-runtime/runtime';
import type { ProductOwner } from './store';

/** Resolve service-owned definitions under the caller's identity, never a cached author identity. */
export async function expandedProductDependencies(owner:ProductOwner,credentials:AssistantCredentials,root:ProductAsset,assets:ProductAsset[]){
  const result=productDependencies(root,assets);
  const expanded:ProductReference[]=[...result.references];
  for(const reference of result.references){
    if(reference.kind==='dashboard'){
      const dashboard=await getOwnedDashboard(owner.userId,owner.domainId,reference.id);
      for(const group of dashboard.groups)for(const card of [...group.metrics,...group.charts]){
        if(card.query?.kind==='metric')expanded.push({kind:'metric',id:card.query.metricId});
      }
    }
    if(reference.kind==='object-view'){
      const response=await backendPost('product-view-dependencies',config.dataQuery.baseUrl+'/objectView/read',{className:reference.id,form:'full'},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
      const state=JSON.parse(response.text);
      if(!state.success||!state.data?.versions?.[0])throw new Error('Published object view unavailable');
      const document=objectViewDocumentSchema.parse(state.data.versions[0].document);
      for(const widget of document.tabs.flatMap(tab=>tab.sections.flatMap(section=>section.widgets))){
        if(widget.resourceId&&['properties','links','metric','table','chart','action'].includes(widget.kind))expanded.push({kind:widget.kind==='action'?'action':'metric',id:widget.resourceId});
      }
    }
  }
  return {...result,references:[...new Map(expanded.map(reference=>[`${reference.kind}:${reference.id}`,reference])).values()]};
}
