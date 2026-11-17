import { productAssetSchema,productPageSchema,productCountsResponseSchema, type ProductQuery, type ProductAssetInput } from "@ontomato/contracts/product-assets";
import type { ManagerRequest } from "../api";
import type {ProductSubscriptionTarget,ProductSubscriptionEvent} from '@ontomato/contracts/product-subscriptions';
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
    nativeBinding:async(id:string)=>{const result=await send(`/${encodeURIComponent(id)}`);return {agentId:result.nativeAgentId as string|undefined,applicationId:result.nativeApplicationId as string|undefined};},
    graph:async()=>productGraphSchema.parse((await send('/graph')).graph),
    defaultProjectionWarnings:async()=>defaultProjectionWarningsSchema.parse(await send('/validation/default-projections')),
    projections:async(kind:'ObjectType'|'Definition'|'MetricView'|'Action',id:string)=>{const result=await send('/projections?'+new URLSearchParams({kind,id}));return {...result,assets:result.assets.map((asset:unknown)=>productAssetSchema.parse(asset))};},
    subscribe:async(target:ProductSubscriptionTarget,effect:(event:ProductSubscriptionEvent)=>void,onError?:(error:Error)=>void)=>{
      const subscription=await send('/subscriptions','POST',target);
      let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
      const dispose=()=>{disposed=true;if(timer)clearTimeout(timer);void send(`/subscriptions/${encodeURIComponent(subscription.id)}`,'DELETE').catch(()=>{});};
      const poll=async()=>{
        if(disposed)return;
        try{const result=await send(`/subscriptions/${encodeURIComponent(subscription.id)}`);if(disposed)return;for(const event of result.events as ProductSubscriptionEvent[])effect(event);}
        catch(error){dispose();onError?.(error instanceof Error?error:new Error(String(error)));return;}
        timer=setTimeout(()=>void poll(),subscription.intervalMs);
      };
      timer=setTimeout(()=>void poll(),subscription.intervalMs);
      return dispose;
    },
    agentContext:async(id:string)=>send(`/${encodeURIComponent(id)}/agent-context`),
    sourceTypes:async(id:string)=>send(`/${encodeURIComponent(id)}/source-types`) as Promise<{objectTypes:string[];complete:boolean}>,
    object:async(id:string,primaryKey:string,revision?:number)=>send(`/${encodeURIComponent(id)}/object`,'POST',{primaryKey,revision}) as Promise<{object:Record<string,unknown>}>,
    grants:async(id:string)=>send(`/${encodeURIComponent(id)}/grants`) as Promise<{grants:{principalKind:string;principalId:string;verb:string}[]}>,
    changeGrant:async(id:string,grant:{principalKind:'principal'|'role';principalId:string;verb:'use'|'edit';remove:boolean})=>send(`/${encodeURIComponent(id)}/grants`,'POST',grant),
    changeDomainGrant:async(id:string,shared:boolean)=>send(`/${encodeURIComponent(id)}/domain-grant`,'POST',{shared}),
    publish:async(id:string,revision:number)=>send(`/${encodeURIComponent(id)}/publish`,'POST',{revision}),
    retryPublication:async(id:string)=>send(`/${encodeURIComponent(id)}/retry-publication`,'POST',{}),
    upgrade:async(id:string)=>send(`/${encodeURIComponent(id)}/upgrade`) as Promise<{releaseId:string;revision:number;assets:{id:string;change:string;fromRevision?:number;toRevision?:number}[];contracts:{kind:string;id:string;change:string}[]}>,
    releases:async(id:string)=>send(`/${encodeURIComponent(id)}/releases`) as Promise<{releases:{releaseId:string;createdAt:string;active:boolean}[]}>,
    rollback:async(id:string,releaseId:string)=>send(`/${encodeURIComponent(id)}/rollback`,'POST',{releaseId}),
    migrate:async(id:string,revision:number)=>productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/migrate`,'POST',{revision})).asset),
    migrateDashboard:async(id:string,revision:number)=>productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/migrate-dashboard`,'POST',{revision})).asset),
    migratePlatform:async(id:string,revision:number,profileId?:string)=>productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/migrate-platform`,'POST',{revision,profileId})).asset),
    executeProfileTool:async(profileId:string,toolId:string,parameters:Record<string,unknown>)=>send(`/${encodeURIComponent(profileId)}/tools/${encodeURIComponent(toolId)}`,'POST',{parameters}),
    collection:async(id:string,parameters:Record<string,unknown>,fields:string[],offset=0,projectionId?:string)=>send(`/definitions/${encodeURIComponent(id)}/query`,'POST',{parameters,fields,offset,projectionId}),
    list: async () => ((await send("")).assets as unknown[]).map(asset=>productAssetSchema.parse(asset)),
    query:async(query:Partial<ProductQuery>={})=>productPageSchema.parse(await send('/query?'+new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])))),
    counts:async()=> productCountsResponseSchema.parse(await send('/counts')).counts,
    get: async (id:string) => {const result=await send(`/${encodeURIComponent(id)}`);if(result.issues?.some((issue:{assetId:string})=>issue.assetId===id))throw new Error('A referenced capability contract changed; upgrade this product release');return productAssetSchema.parse(result.asset);},
    dependencies: async(id:string)=>{const result=await send(`/${encodeURIComponent(id)}/dependencies`);return {graph:productGraphSchema.parse(result.graph),references:result.references as import('@ontomato/contracts/product-assets').ProductReference[],usedBy:result.usedBy as {id:string;name:string}[]};},
    home: async () => productAssetSchema.parse((await send("/home")).asset),
    overlay:async(id:string)=>send(`/${encodeURIComponent(id)}/overlay`),
    saveOverlay:async(id:string,workspace:import('@ontomato/contracts/personal-workspace').PersonalWorkspace,revision:number)=>send(`/${encodeURIComponent(id)}/overlay`,'PUT',{workspace,revision}),
    save: async (id:string, input:ProductAssetInput, revision:number) => productAssetSchema.parse((await send(`/${encodeURIComponent(id)}`,"PUT",{name:input.name,description:input.description,document:input.document,revision})).asset),
    copy: async (id:string,name:string) => productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/copy`,"POST",{name})).asset),
    createPage:async(id:string,name:string)=>productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/create-page`,'POST',{name})).asset),
    createDashboard:async(name:string)=>{
      const response=await request.request('/dashboards/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})},'');
      const result=await response.json();
      if(result.success===false||!result.data?.productAssetId)throw new Error(result.message??'Dashboard creation failed');
      return productAssetSchema.parse((await send(`/${encodeURIComponent(result.data.productAssetId)}`)).asset);
    },
    useHome: async (id:string,revision:number) => productAssetSchema.parse((await send(`/${encodeURIComponent(id)}/use-home`,"POST",{revision})).asset),
    delete: async (id:string,revision:number) => { await send(`/${encodeURIComponent(id)}`,"DELETE",{revision}); },
  };
}
