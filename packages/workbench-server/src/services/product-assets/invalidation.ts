import {getProduct,type ProductOwner} from './store';
import {productReferences} from '@ontomato/contracts/product-assets';
import {readDefinition} from './definitions';
import {DashboardMetricClient} from '../dashboard/metric-client';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';

export async function projectionSourceTypes(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  const asset=await getProduct(owner,id);const types=new Set<string>();let complete=true;
  for(const reference of productReferences(asset.document)){
    if(reference.kind==='object-type')types.add(reference.id);
    if(reference.kind==='definition')types.add((await readDefinition(owner,reference.id)).objectType);
    if(reference.kind==='metric'){
      const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(reference.id);
      if(!metric.sourceObjectTypes)complete=false;
      for(const type of metric.sourceObjectTypes??[])types.add(type);
    }
  }
  return {objectTypes:[...types],complete};
}
