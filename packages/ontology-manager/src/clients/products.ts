import { productAssetSchema } from "@ontomato/contracts/product-assets";
import { productGrantsResponseSchema, type ChangeProductGrantRequest } from "@ontomato/contracts/product-governance";
import type { ManagerRequest } from "../api";
import {productGraphSchema,defaultProjectionWarningsSchema} from '@ontomato/contracts/product-graph';

/** Manual authoring, embedded apps and AI commands share this authenticated asset API. */
export function createProductsClient(request: Pick<ManagerRequest,"request">) {
  async function send(path: string, method = "GET", body?: unknown) {
    const response = await request.request(`/product-assets${path}`, {method,headers:{"Content-Type":"application/json"},body:body === undefined ? undefined : JSON.stringify(body)}, "");
    const result=await response.json();
    if(!response.ok)throw new Error(result.error?.message??'Product request failed');
    return result;
  }
  return {
    synchronizePlatform:async()=>send('/synchronize-platform','POST',{}),
    nativeBinding:async(id:string)=>{const result=await send(`/${encodeURIComponent(id)}`);return {applicationId:result.nativeApplicationId as string|undefined};},
    graph:async()=>productGraphSchema.parse((await send('/graph')).graph),
    defaultProjectionWarnings:async()=>defaultProjectionWarningsSchema.parse(await send('/validation/default-projections')),
    projections:async(kind:'ObjectType'|'Definition'|'MetricView'|'Action',id:string)=>{const result=await send('/projections?'+new URLSearchParams({kind,id}));return {...result,assets:result.assets.map((asset:unknown)=>productAssetSchema.parse(asset))};},
    sourceTypes:async(id:string)=>send(`/${encodeURIComponent(id)}/source-types`) as Promise<{objectTypes:string[];complete:boolean}>,
    object:async(id:string,primaryKey:string,revision?:number)=>send(`/${encodeURIComponent(id)}/object`,'POST',{primaryKey,revision}) as Promise<{object:Record<string,unknown>}>,
    grants:async(id:string)=>productGrantsResponseSchema.parse(await send(`/${encodeURIComponent(id)}/grants`)),
    changeGrant:async(id:string,grant:ChangeProductGrantRequest)=>send(`/${encodeURIComponent(id)}/grants`,'POST',grant),
    changeDomainGrant:async(id:string,shared:boolean)=>send(`/${encodeURIComponent(id)}/domain-grant`,'POST',{shared}),
    collection:async(id:string,parameters:Record<string,unknown>,fields:string[],offset=0,projectionId?:string)=>send(`/definitions/${encodeURIComponent(id)}/query`,'POST',{parameters,fields,offset,projectionId}),
    get: async (id:string) => {const result=await send(`/${encodeURIComponent(id)}`);if(result.issues?.some((issue:{assetId:string})=>issue.assetId===id))throw new Error('A referenced capability contract changed; upgrade this product release');return productAssetSchema.parse(result.asset);},
    dependencies: async(id:string)=>{const result=await send(`/${encodeURIComponent(id)}/dependencies`);return {graph:productGraphSchema.parse(result.graph),references:result.references as import('@ontomato/contracts/product-assets').ProductReference[],usedBy:result.usedBy as {id:string;name:string}[]};},
  };
}
