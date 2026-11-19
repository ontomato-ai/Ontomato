import {APP_BRIDGE_CHANNEL,appBridgeConfirmPanelOperationResultSchema,appBridgeConfirmPanelOperationSchema,type AppBridgeConfirmPanelOperation,type AppBridgeConfirmPanelOperationResult,type AppBridgeExpandPageComposer,type AppBridgeResponse} from '@ontomato/contracts/app-bridge';
import type {AppHost,AppHostSnapshot,AppHostPreferences,AppFrameInsets} from '@ontomato/contracts/app-host';
import type {AppExecutionContext} from '@ontomato/contracts/build-tests';
import {randomId} from '@ontomato/contracts/random-id';

const composerExpanders=new WeakMap<AppHost,(request:AppBridgeExpandPageComposer)=>Promise<void>>();

/** Asks the platform host to expand the page's composer with a slot's declared conversation entry. */
export function expandHostPageComposer(host:AppHost,request:AppBridgeExpandPageComposer):Promise<void>{
  const expand=composerExpanders.get(host);
  if(!expand)return Promise.reject(new Error('This host does not support expanding the page composer'));
  return expand(request);
}

/** What a panel frame asks its host beyond an app's: to confirm a prepared write where it must and dispatch it once. */
export interface PanelBridgeHost extends AppHost {
  confirmPanelOperation(preparation:AppBridgeConfirmPanelOperation):Promise<AppBridgeConfirmPanelOperationResult>;
}

/** Opaque frames receive data and operations over a port, never the parent's credential or DOM. */
export async function connectAppBridge():Promise<PanelBridgeHost>{
  const channel=new MessageChannel();
  const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>|undefined}>();
  const streams=new Map<string,ReadableStreamDefaultController<Uint8Array>>(),streamCleanup=new Map<string,()=>void>();
  const placements=new Set<()=>void>();
  const preferenceListeners=new Set<(preferences:AppHostPreferences)=>void>(),insetListeners=new Set<(insets:AppFrameInsets)=>void>();
  let snapshot:AppHostSnapshot,execution:AppExecutionContext,closed=false;
  const notify=(operation:string,payload?:unknown)=>{void invoke(operation,payload).catch(()=>{});};
  channel.port1.onmessage=event=>{
    const message=event.data as AppBridgeResponse&{event?:string};
    if(message.channel!==APP_BRIDGE_CHANNEL)return;
    if(message.event==='viewport'){for(const place of placements)place();return;}
    if(message.event==='chunk'){streams.get(message.id)?.enqueue(message.result as Uint8Array);return;}
    if(message.event==='end'||message.event==='stream-error'){const stream=streams.get(message.id);if(stream){if(message.event==='end')stream.close();else stream.error(new Error(message.error??'Stream failed'));streams.delete(message.id);}streamCleanup.get(message.id)?.();streamCleanup.delete(message.id);return;}
    if(message.event==='preferences'){snapshot={...snapshot,...message.result as AppHostPreferences};for(const listener of preferenceListeners)listener(snapshot);return;}
    const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);
    if(message.error)call.reject(new Error(message.error));else{
      const result=message.result as {stream?:boolean;body?:ReadableStream<Uint8Array>};
      if(result?.stream)result.body=new ReadableStream<Uint8Array>({start:controller=>{streams.set(message.id,controller);},cancel:()=>{streams.delete(message.id);streamCleanup.get(message.id)?.();streamCleanup.delete(message.id);void invoke('cancel',{requestId:message.id}).catch(()=>{});}});
      call.resolve(result);
    }
  };
  /** A call the reader answers (`untimed`) waits for them; any other times out, and closing the page ends both. */
  function invoke(operation:string,payload?:unknown,signal?:AbortSignal,untimed=false):Promise<any>{
    if(closed)return Promise.reject(new Error('Application bridge is closed'));
    const id=randomId();
    return new Promise((resolve,reject)=>{
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const abort=()=>{const call=pending.get(id);if(call){clearTimeout(call.timer);pending.delete(id);reject(new DOMException('Request aborted','AbortError'));}streams.get(id)?.error(new DOMException('Request aborted','AbortError'));streams.delete(id);streamCleanup.delete(id);cleanup();channel.port1.postMessage({channel:APP_BRIDGE_CHANNEL,id:randomId(),operation:'cancel',payload:{requestId:id}});};
      if(signal?.aborted){reject(new DOMException('Request aborted','AbortError'));return;}
      signal?.addEventListener('abort',abort,{once:true});
      const timer=untimed?undefined:setTimeout(()=>{pending.delete(id);cleanup();channel.port1.postMessage({channel:APP_BRIDGE_CHANNEL,id:randomId(),operation:'cancel',payload:{requestId:id}});reject(new Error('Platform bridge request timed out'));},60_000);
      pending.set(id,{resolve:value=>{if((value as {stream?:boolean})?.stream)streamCleanup.set(id,cleanup);else cleanup();resolve(value);},reject:error=>{cleanup();reject(error);},timer});channel.port1.postMessage({channel:APP_BRIDGE_CHANNEL,id,operation,payload});
    });
  }
  window.parent.postMessage({channel:APP_BRIDGE_CHANNEL,operation:'connect'},'*',[channel.port2]);
  const initial=await invoke('initialize');snapshot=initial.snapshot;execution=initial.execution;
  const host:PanelBridgeHost={
    snapshot:()=>snapshot,credential:()=>({type:'anonymous'}),executionContext:()=>execution,
    subscribeExecutionContext:(_source,listener)=>{listener(execution);return ()=>{};},
    subscribePreferences:listener=>{preferenceListeners.add(listener);return ()=>preferenceListeners.delete(listener);},
    subscribeFrameInsets:(_source,listener)=>{insetListeners.add(listener);listener({bottom:0});return ()=>insetListeners.delete(listener);},
    navigate:path=>notify('navigate',path),navigateProduct:async(_source,target)=>{await invoke('navigateProduct',target);},
    onAuthFailure:status=>notify('authFailure',status),setPageContext:(_source,context)=>notify('pageContext',context),
    invalidateProductData:(_source,event)=>notify('invalidate',event),
    // The host confirms where it must and dispatches once; its answer is Node's receipt, so the frame never retries.
    async confirmPanelOperation(preparation){
      const result=await invoke('confirm-panel-operation',appBridgeConfirmPanelOperationSchema.parse(preparation),undefined,true);
      return appBridgeConfirmPanelOperationResultSchema.parse(result);
    },
    async request(_source,path,init,service){
      const headers=[...new Headers(init.headers).entries()];
      let body:unknown=init.body??null;
      if(body instanceof FormData)body={form:[...body.entries()]};
      const response=await invoke('request',{path,service,method:init.method??'GET',headers,body},init.signal??undefined);
      return new Response([204,205,304].includes(response.status)?null:response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
    },
    mountProductAsset(_source,element,assetId){
      const container=element as HTMLElement,id=randomId();let disposed=false;
      container.style.minHeight='240px';
      let mounted=false;
      const place=()=>{if(disposed||!mounted)return;const rectangle=container.getBoundingClientRect();void invoke('placement',{id,x:rectangle.x,y:rectangle.y,width:rectangle.width,height:rectangle.height,visible:rectangle.bottom>0&&rectangle.top<innerHeight}).catch(()=>{});};
      void invoke('mount',{id,assetId}).then(()=>{mounted=true;if(disposed)void invoke('unmount',{id}).catch(()=>{});else place();}).catch(error=>{if(!disposed){container.textContent=error instanceof Error?error.message:String(error);container.setAttribute('role','alert');}});
      const observer=new ResizeObserver(place);observer.observe(container);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
      placements.add(place);
      return ()=>{disposed=true;placements.delete(place);observer.disconnect();window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);if(mounted)void invoke('unmount',{id}).catch(()=>{});};
    },
  };
  composerExpanders.set(host,async request=>{await invoke('expand-page-composer',request);});
  window.addEventListener('pagehide',()=>{closed=true;channel.port1.close();for(const stream of streams.values())stream.error(new Error('Application closed'));streams.clear();for(const cleanup of streamCleanup.values())cleanup();streamCleanup.clear();for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('Application closed'));}pending.clear();},{once:true});
  return host;
}
