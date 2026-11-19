import {createVNode,render,type App} from 'vue';
import {APP_BRIDGE_CHANNEL,appBridgeRequestSchema,appBridgeHttpSchema,appBridgeMountSchema,appBridgePlacementSchema,appBridgeUnmountSchema,appBridgePathSchema,appBridgeAuthStatusSchema,appBridgeInvalidationSchema,appBridgeCancelSchema,appBridgePageContextSchema,appBridgeExpandPageComposerSchema,type AppBridgeExpandPageComposer,appBridgeConfirmPanelOperationSchema,type AppBridgeConfirmPanelOperation,type AppBridgeConfirmPanelOperationResult} from '@ontomato/contracts/app-bridge';
import type {AppHost} from '@ontomato/contracts/app-host';
import ProductRoute from './pages/ProductRoute.vue';

/** Bind one transferred port to the exact registered frame; messages never select an application identity. */
/**
 * `open` says whether a frame may ask for anything now: a frame kept for a page the reader left may still cancel or
 * unmount what it started, and gets the answer of a call it made before, but asks for nothing new.
 * `expandComposer` answers a frame's request to expand the page's composer; it checks the request against what the
 * frame's own declaration allows. `confirmOperation` asks the person, in the platform's own dialog, whether an operation
 * the frame's declaration holds may go ahead; the call is answered with that decision.
 */
export function installAppBridge(app:App,host:AppHost,applicationFor:(source:object)=>string|undefined,open:(source:object)=>boolean,expandComposer:(source:object,request:AppBridgeExpandPageComposer)=>void,confirmOperation:(source:object,request:AppBridgeConfirmPanelOperation)=>Promise<AppBridgeConfirmPanelOperationResult>){
  const connections=new Map<object,{dispose:()=>void;pause:()=>void;resume:()=>void}>();
  function connect(event:MessageEvent){
    if(event.data?.channel!==APP_BRIDGE_CHANNEL||event.data?.operation!=='connect'||!event.source||event.ports.length!==1)return;
    const source=event.source as Window,applicationId=applicationFor(source);if(!applicationId)return;
    if(event.origin!=='null')return;
    const frame=[...document.querySelectorAll('iframe')].find(frame=>frame.contentWindow===source);
    if(!frame||!frame.sandbox.contains('allow-scripts')||frame.sandbox.contains('allow-same-origin'))return;
    connections.get(source)?.dispose();
    const port=event.ports[0],mounts=new Map<string,HTMLElement>(),requests=new Map<string,AbortController>();
    let closed=false;
    const dispose=()=>{if(closed)return;closed=true;for(const request of requests.values())request.abort();requests.clear();port.close();stopPreferences();viewport.disconnect();window.removeEventListener('scroll',hideOutsideViewport,true);for(const element of mounts.values()){render(null,element);element.remove();}mounts.clear();connections.delete(source);};
    const hideOutsideViewport=()=>{for(const element of mounts.values())element.style.display='none';if(open(source))port.postMessage({channel:APP_BRIDGE_CHANNEL,event:'viewport'});};
    const viewport=new ResizeObserver(hideOutsideViewport);viewport.observe(frame);window.addEventListener('scroll',hideOutsideViewport,true);
    const sendPreferences=()=>{const {locale,theme}=host.snapshot();port.postMessage({channel:APP_BRIDGE_CHANNEL,event:'preferences',result:{locale,theme}});};
    const stopPreferences=host.subscribePreferences(()=>{if(open(source))sendPreferences();});
    // The requests answered as event streams: they last as long as the stream, not one answer.
    const streams=new Set<string>();
    // A frame whose page the reader left hears nothing and keeps no stream; opened again, it hears the preferences of now.
    connections.set(source,{dispose,pause:()=>{for(const id of streams)requests.get(id)?.abort();},resume:sendPreferences});
    const current=()=>{if(closed||applicationFor(source)!==applicationId||!frame.isConnected)throw new Error('Application frame is no longer registered');};
    port.onmessage=async event=>{
      const parsed=appBridgeRequestSchema.safeParse(event.data);if(!parsed.success)return;
      const {id,operation,payload}=parsed.data;
      try{
        current();let result:unknown=null;
        if(operation!=='cancel'&&operation!=='unmount'&&!open(source))throw new Error('This page is not shown');
        if(operation==='initialize')result={snapshot:host.snapshot(),execution:host.executionContext(source)};
        else if(operation==='request'){
          const input=appBridgeHttpSchema.parse(payload);
          let body:BodyInit|undefined;
          if(typeof input.body==='string')body=input.body;
          else if(input.body!==null&&input.body!==undefined){const data=input.body as {form:unknown};if(!data||!Array.isArray(data.form))throw new Error('Invalid form body');const form=new FormData();for(const entry of data.form){if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||typeof entry[1]!=='string'&&!(entry[1] instanceof Blob))throw new Error('Invalid form entry');form.append(entry[0],entry[1]);}body=form;}
          if(requests.has(id)||requests.size>=20)throw new Error('Invalid or excessive concurrent application request');
          const controller=new AbortController();requests.set(id,controller);
          let response:Response;try{response=await host.request!(source,input.path,{method:input.method,headers:input.headers,body,signal:controller.signal},input.service);}catch(reason){requests.delete(id);throw reason;}
          if(response.headers.get('content-type')?.includes('text/event-stream')){
            streams.add(id);
            port.postMessage({channel:APP_BRIDGE_CHANNEL,id,result:{status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],stream:true}});
            try{const reader=response.body?.getReader();if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;current();port.postMessage({channel:APP_BRIDGE_CHANNEL,id,event:'chunk',result:chunk.value});}port.postMessage({channel:APP_BRIDGE_CHANNEL,id,event:'end'});}catch(reason){port.postMessage({channel:APP_BRIDGE_CHANNEL,id,event:'stream-error',error:reason instanceof Error?reason.message:'Stream failed'});}finally{requests.delete(id);streams.delete(id);}return;
          }
          try{result={status:response.status,statusText:response.statusText,headers:[...response.headers.entries()],body:await response.arrayBuffer()};}finally{requests.delete(id);}
        }else if(operation==='cancel'){const {requestId}=appBridgeCancelSchema.parse(payload);requests.get(requestId)?.abort();}
        else if(operation==='navigateProduct')await host.navigateProduct!(source,payload as Parameters<NonNullable<AppHost['navigateProduct']>>[1]);
        else if(operation==='navigate')host.navigate(appBridgePathSchema.parse(payload));
        else if(operation==='pageContext')host.setPageContext(source,appBridgePageContextSchema.parse(payload));
        else if(operation==='authFailure')host.onAuthFailure(appBridgeAuthStatusSchema.parse(payload));
        else if(operation==='invalidate')host.invalidateProductData!(source,appBridgeInvalidationSchema.parse(payload));
        else if(operation==='expand-page-composer')expandComposer(source,appBridgeExpandPageComposerSchema.parse(payload));
        else if(operation==='confirm-panel-operation')result=await confirmOperation(source,appBridgeConfirmPanelOperationSchema.parse(payload));
        else if(operation==='mount'){
          const input=appBridgeMountSchema.parse(payload);
          if(mounts.has(input.id)||mounts.size>=50)throw new Error('Invalid product mount');
          // An embedded product reads live data in the platform's own window: never for a frame on a build-test context.
          if(host.executionContext(source).kind!=='live')throw new Error('Product embedding is unavailable in build-test previews');
          const element=document.createElement('div');Object.assign(element.style,{position:'fixed',overflow:'auto',zIndex:'20',display:'none'});document.body.append(element);
          const vnode=createVNode(ProductRoute,{productAssetId:input.assetId,applicationId,embedded:true});vnode.appContext=app._context;render(vnode,element);mounts.set(input.id,element);
        }else if(operation==='placement'){
          const input=appBridgePlacementSchema.parse(payload);
          const element=mounts.get(input.id);if(!element)throw new Error('Product mount unavailable');
          const bounds=frame.getBoundingClientRect(),left=Math.max(0,input.x),top=Math.max(0,input.y),width=Math.max(0,Math.min(input.x+input.width,bounds.width)-left),height=Math.max(0,Math.min(input.y+input.height,bounds.height)-top);
          Object.assign(element.style,{left:`${bounds.left+left}px`,top:`${bounds.top+top}px`,width:`${width}px`,height:`${height}px`,display:input.visible&&width>0&&height>0?'block':'none'});
        }else if(operation==='unmount'){
          const {id}=appBridgeUnmountSchema.parse(payload);const element=mounts.get(id);if(element){render(null,element);element.remove();mounts.delete(id);}
        }
        current();port.postMessage({channel:APP_BRIDGE_CHANNEL,id,result});
      }catch(reason){port.postMessage({channel:APP_BRIDGE_CHANNEL,id,error:reason instanceof Error?reason.message:'Platform bridge failed'});}
    };
    port.start();
  }
  window.addEventListener('message',connect);
  return {
    disposeFrame:(source:object)=>connections.get(source)?.dispose(),
    /** A frame whose page the reader left keeps the answers of the calls it made, but none of its streams. */
    pauseFrame:(source:object)=>connections.get(source)?.pause(),
    /** The frame's page is the reader's again: it hears the platform's preferences as they are now. */
    resumeFrame:(source:object)=>connections.get(source)?.resume(),
    dispose:()=>{window.removeEventListener('message',connect);for(const connection of [...connections.values()])connection.dispose();},
  };
}
