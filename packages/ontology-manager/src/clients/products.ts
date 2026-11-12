import { productAssetSchema, type ProductAssetInput } from "@ontomato/contracts/product-assets";
import type { ManagerRequest } from "../api";

/** Manual authoring, embedded apps and AI commands share this authenticated asset API. */
export function createProductsClient(request: Pick<ManagerRequest,"request">) {
  async function send(path: string, method = "GET", body?: unknown) {
    const response = await request.request(`/product-assets${path}`, {method,headers:{"Content-Type":"application/json"},body:body === undefined ? undefined : JSON.stringify(body)}, "");
    return response.json();
  }
  return {
    list: async () => ((await send("")).assets as unknown[]).map(asset=>productAssetSchema.parse(asset)),
    get: async (id:string) => productAssetSchema.parse((await send(`/${encodeURIComponent(id)}`)).asset),
    home: async () => productAssetSchema.parse((await send("/home")).asset),
    save: async (id:string, input:ProductAssetInput, revision:number) => productAssetSchema.parse((await send(`/${encodeURIComponent(id)}`,"PUT",{...input,revision})).asset),
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
