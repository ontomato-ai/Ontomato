import type { AppExecutionContext } from "@ontomato/contracts/build-tests";
import {BUILD_TEST_HEADER,BUILD_TEST_UNSUPPORTED} from '@ontomato/contracts/build-tests';
import { watch,createVNode,render,type App } from "vue";
import ProductRoute from './pages/ProductRoute.vue';
import type { Router } from "vue-router";
import {
  APP_HOST_GLOBAL,
  type AppFrameInsets,
  type AppHost,
  type AppHostCredential,
  type AppHostPreferences,
} from "@ontomato/contracts/app-host";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { authHost } from "@ontomato/workbench-ui/utils/auth";
import { readRuntimeConfig } from "./config";
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import {productReferences} from '@ontomato/contracts/product-assets';
import {validatePageState,validateProductNavigation,productNavigationTargetSchema} from '@ontomato/contracts/product-page-state';
import {invalidateProductData} from '@ontomato/contracts/product-invalidation';
import {installAppBridge} from './app-bridge';
import type {PanelManifest} from '@ontomato/contracts/panel-manifest';
import {METRIC_CHART_COMPONENT,productProjectionResponseSchema} from '@ontomato/contracts/product-panels';
import {pageDraftCreatedSchema,pageDraftReadSchema} from '@ontomato/contracts/page-draft';
import {chartProjectionLookupRead,chartProjectionSourceSends,clientSends} from '@ontomato/contracts/panel-client-requests';
import {projectionBindingKeys} from '@ontomato/contracts/panel-projection';

const executionBindings = new WeakMap<object, AppExecutionContext>();
const publishedFrames=new WeakMap<object,string>();
/**
 * One panel instance's frame, in a panel application (`entry.renderer` is `panels`) or in an author's candidate preview.
 * Such an application has no published record and no build of its own: its pages are use relations of shared panels. Its
 * frame is narrowed by what the panel declares, as a published application's frame is by its publication: the
 * projections its declaration names, the requests the SDK clients their bindings reach send
 * (`@ontomato/contracts/panel-client-requests`), and the drafts written for its page. Nothing else leaves it.
 */
interface PanelFrame {
  /**
   * What the bridge binds the frame's port to: the panel application's ID, or the candidate's workspace. A frame of one
   * is never mistaken for a frame of another.
   */
  bridgeIdentity: string;
  /** The use relation's page key: a draft this frame reads must have been written for it. */
  pageKey: string;
  /**
   * Every projection the panel's declaration names, with the binding of its current record once the frame has read it
   * through this host. The record is Node's, read with the reader's credential, so the binding is the owner's, not the
   * frame's word; a projection read again after its definition changed brings its new bindings — a graph's edges
   * included.
   */
  bindings: Map<string,readonly string[]|null>;
  /**
   * The create drafts this frame has read for its page, as `<session>/<run>/<path>`: the only drafts whose created object
   * it may record after the reader's first save.
   */
  createDrafts: Set<string>;
  /**
   * The projections this frame has read as MetricCharts, by ID. Only their chart sources are this frame's to read or
   * redraw, and only a frame showing a chart looks a source card up; the owner still checks use and edit.
   */
  charts: Set<string>;
}
const panelFrames=new WeakMap<object,PanelFrame>();
const PROJECTION_READ=/^\/product-projections\/([^/?]+)$/;
const DRAFT_READ=/^\/assistant\/sessions\/([^/?]+)\/runs\/([^/?]+)\/page-draft\?([^#]*)$/;
const DRAFT_CREATED=/^\/assistant\/sessions\/([^/?]+)\/runs\/([^/?]+)\/page-draft\/created$/;
const draftKey=(session:string,run:string,path:string)=>`${decodeURIComponent(session)}/${decodeURIComponent(run)}/${path}`;
const executionListeners = new WeakMap<object, Set<(context: AppExecutionContext) => void>>();
const frameInsets = new WeakMap<object, AppFrameInsets>();
const insetListeners = new WeakMap<object, Set<(insets: AppFrameInsets) => void>>();
const NO_INSETS: AppFrameInsets = { bottom: 0 };
let bridge:ReturnType<typeof installAppBridge>|undefined;
/** Mounted after the shell installs its context, router and identity providers. */
export function installProductEmbedding(app:App){
  const host=(window as Window & {[APP_HOST_GLOBAL]?:AppHost})[APP_HOST_GLOBAL];
  if(!host)return;
  // The bridge answers a frame as the application it was registered under: a published application's, or a panel
  // application's.
  bridge?.dispose();bridge=installAppBridge(app,host,source=>publishedFrames.get(source)??panelFrames.get(source)?.bridgeIdentity);
  host.mountProductAsset=(source,target,assetId)=>{
    const element=target as HTMLElement;
    if(executionContext(source).kind!=='live')throw new Error('Product embedding is unavailable in build-test previews; use product authoring commands');
    if(!element?.ownerDocument?.defaultView||!(element instanceof element.ownerDocument.defaultView.HTMLElement)||element.ownerDocument.defaultView!==source)throw new Error('Product mount must belong to the registered app frame');
    if(!assetId.trim()||assetId.length>200)throw new Error('Invalid product asset ID');
    const applicationId=publishedFrames.get(source);
    if(!applicationId)throw new Error('Published application identity is required for product embedding');
    const shadow=element.shadowRoot??element.attachShadow({mode:'open'});
    shadow.replaceChildren();
    const syncStyles=()=>{
      shadow.querySelectorAll('[data-product-style]').forEach(node=>node.remove());
      for(const style of document.head.querySelectorAll('style,link[rel="stylesheet"]')){
        const clone=style.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-product-style','');
        if(clone.tagName==='LINK')clone.setAttribute('href',(style as HTMLLinkElement).href);
        shadow.prepend(clone);
      }
    };
    syncStyles();
    const observer=new MutationObserver(syncStyles);observer.observe(document.head,{childList:true,subtree:true,characterData:true});
    const container=element.ownerDocument.createElement('div');container.style.minWidth='0';shadow.append(container);
    const vnode=createVNode(ProductRoute,{productAssetId:assetId,embedded:true,applicationId});vnode.appContext=app._context;
    render(vnode,container);
    return ()=>{observer.disconnect();render(null,container);shadow.replaceChildren();};
  };
}
function assertFrameBinding(previous: AppExecutionContext | undefined, next: AppExecutionContext) {
  if(previous && (previous.kind!==next.kind || previous.kind==="build-test" && next.kind==="build-test" && (previous.contextId!==next.contextId || previous.workspaceId!==next.workspaceId)))
    throw new Error("Reload the preview frame to change its execution context");
}
/** Register before the frame runs. Updating its ID requires a new frame. */
function registerFrame(source: object, context: AppExecutionContext) {
  assertFrameBinding(executionBindings.get(source),context);
  executionBindings.set(source, context);
  return {
    update(next: AppExecutionContext) {
      const previous=executionBindings.get(source);
      assertFrameBinding(previous,next);
      executionBindings.set(source,next);
      for(const listener of executionListeners.get(source) ?? []) listener(next);
    },
    /** The room the shell's own controls now cover over the frame. */
    setInsets(insets: AppFrameInsets) {
      frameInsets.set(source, insets);
      for (const listener of insetListeners.get(source) ?? []) listener(insets);
    },
    // Keep the last binding until the Window is collected: detached frames must never become live.
    dispose() { executionListeners.delete(source); insetListeners.delete(source); },
  };
}

export function registerBuildPreview(source: object, context: AppExecutionContext) {
  if(context.kind!=="build-test") throw new Error("A preview requires a build-test binding");
  return registerFrame(source,context);
}
/** Published application frames explicitly select live execution through this module. */
export function registerLiveFrame(source: object,applicationId?:string) {
  if(applicationId)publishedFrames.set(source,applicationId);
  const binding=registerFrame(source,{kind:"live"});
  return ()=>{bridge?.disposeFrame(source);publishedFrames.delete(source);binding.dispose();};
}

type PanelDeclaration = { pageKey: string; manifest: PanelManifest };

function registerDeclaredFrame(source: object, bridgeIdentity: string, panel: PanelDeclaration, context: AppExecutionContext) {
  panelFrames.set(source,{bridgeIdentity,pageKey:panel.pageKey,bindings:new Map(Object.values(panel.manifest.slots).map(slot=>[slot.projectionId,null])),createDrafts:new Set(),charts:new Set()});
  const binding=registerFrame(source,context);
  return ()=>{bridge?.disposeFrame(source);panelFrames.delete(source);binding.dispose();};
}

/**
 * The frame one panel instance runs in, as a live frame of the panel application whose page shows it, narrowed by the
 * panel's declaration. The panel host draws it sandboxed with scripts only, so it speaks the message bridge, and
 * registers it as soon as the frame exists, before the panel's module can ask to connect.
 */
export function registerPanelFrame(source: object,applicationId: string,panel:PanelDeclaration) {
  return registerDeclaredFrame(source,applicationId,panel,{kind:"live"});
}

/**
 * The frame of an author's candidate preview: narrowed by the candidate's declaration like any panel frame, and running
 * on its workspace's build-test context — never live. Its requests carry that context to their owners, which accept
 * them only where they declared support for test data or definition-only reads.
 */
export function registerCandidateFrame(source: object,context: Extract<AppExecutionContext,{kind:"build-test"}>,panel:PanelDeclaration) {
  return registerDeclaredFrame(source,`workspace:${context.workspaceId}`,panel,context);
}
/** Refuses, before anything is sent, a request of a panel's frame that its declaration does not cover. */
function admitPanelRequest(panel:PanelFrame,method:string,path:string,service:string,body:BodyInit|null|undefined){
  if(service===''&&method==='GET'){
    const projection=PROJECTION_READ.exec(path);
    if(projection&&panel.bindings.has(decodeURIComponent(projection[1]!)))return;
    if(DRAFT_READ.test(path))return;
  }
  if(chartProjectionSourceSends(panel.charts,method,service,path))return;
  const lookup=chartProjectionLookupRead;
  if(panel.charts.size&&method===lookup.method&&service===lookup.service&&lookup.path.test(path))return;
  // A request about one object of a binding (the metric a MetricView binding names) is checked against its JSON body.
  const decoded:unknown=typeof body==='string'&&body?JSON.parse(body):undefined;
  // The reader's first save of a create draft this frame read for its page records the object it created on that draft.
  const created=service===''&&method==='POST'?DRAFT_CREATED.exec(path):null;
  const record=created?pageDraftCreatedSchema.safeParse(decoded):null;
  if(record?.success&&panel.createDrafts.has(draftKey(created![1]!,created![2]!,record.data.path)))return;
  const bindings=[...panel.bindings.values()].flatMap(keys=>keys??[]);
  if(!clientSends(bindings,method,service,path,decoded))throw new Error("Outside what this panel's projections declare");
}

/**
 * What a panel's frame learns from a read it made: a projection's current binding, which admits the requests of the
 * client it reaches, and a draft, which is handed over only when it was written for this frame's page.
 */
async function relayToPanel(panel:PanelFrame,method:string,path:string,service:string,response:Response){
  if(!response.ok||service!==''||method!=='GET')return response;
  const projection=PROJECTION_READ.exec(path);
  if(projection){
    const record=productProjectionResponseSchema.parse(await response.clone().json()).projection;
    const id=decodeURIComponent(projection[1]!);
    panel.bindings.set(id,projectionBindingKeys(record));
    if(record.componentId===METRIC_CHART_COMPONENT)panel.charts.add(id);
    else panel.charts.delete(id);
    return response;
  }
  const read=DRAFT_READ.exec(path);
  if(!read)return response;
  const draft=pageDraftReadSchema.parse(await response.clone().json());
  if(draft.pageKey!==panel.pageKey)throw new Error('This draft was written for another page');
  if(draft.target.id===undefined)panel.createDrafts.add(draftKey(read[1]!,read[2]!,new URLSearchParams(read[3]).get('path')!));
  return response;
}
function executionContext(source: object) {
  const context=executionBindings.get(source);
  if(!context) throw Object.assign(new Error("Frame execution context is not registered"),{code:"APP_HOST_FRAME_UNREGISTERED"});
  return context;
}

type PageContextListener = AppHost["setPageContext"];
const pageContextListeners = new Set<PageContextListener>();

/**
 * Hears every app frame of this window say what its reader looks at (`AppHost.setPageContext`) until the returned
 * function is called; `source` tells the frames apart. A page that shows an app beside its agent listens while it is
 * open (the app builder, for its preview); with no one listening, the call has no effect.
 */
export function subscribeAppPageContext(listener: PageContextListener) {
  pageContextListeners.add(listener);
  return () => {
    pageContextListeners.delete(listener);
  };
}

/**
 * Installs the port for the apps this shell shows in a same-origin iframe. It hands over values and calls of this page
 * load, never its Vue state: an app runs its own Vue and SDK version. The credential and the auth failure handling are
 * the ones the edition already gives its Manager pages, so a changed identity rebuilds the page and its app frames.
 */
export function installAppHost(options: {
  credential: AppHostCredential | null;
  preferences: PlatformPreferences;
  router: Router;
  onAuthFailure(status: 401 | 402): void;
}) {
  const { preferences } = options;
  const current = (): AppHostPreferences => ({ locale: preferences.locale.value, theme: preferences.theme.value });
  (window as Window & { [APP_HOST_GLOBAL]?: AppHost })[APP_HOST_GLOBAL] = {
    snapshot() {
      const user = authHost().getUserInfo();
      return {
        ...current(),
        apiBase: readRuntimeConfig().apiBase,
        user: user && { userId: user.userId, loginCode: user.loginCode, userName: user.userName, domainId: user.domainId },
      };
    },
    executionContext,
    async request(source,path,init,service){
      const execution=executionContext(source);
      if(!path.startsWith('/')||path.startsWith('//')||/[#\\]/.test(path)||!['','/data-query'].includes(service))throw new Error('Invalid SDK request target');
      const decoded=decodeURIComponent(path.split('?')[0]);
      if(decoded.includes('\\')||decoded.split('/').some(segment=>segment==='.'||segment==='..'))throw new Error('Invalid SDK request target');
      const method=(init.method??'GET').toUpperCase();
      // A panel's frame asks only for what its own declaration covers; every other frame for the SDK's capabilities.
      const panel=panelFrames.get(source);
      if(panel)admitPanelRequest(panel,method,path,service,init.body);
      else{
        const allowed=service==='/data-query'?['/metricView/queryById','/metricView/execute','/action/form','/action/execute']:[];
        if(service==='/data-query'&&!allowed.includes(path))throw new Error('Use a declared SDK capability');
        const declared=['/product-assets','/assistant'].some(prefix=>path===prefix||path.startsWith(prefix+'/')||path.startsWith(prefix+'?'));
        if(service===''&&!declared)throw new Error('Use a declared SDK product operation');
      }
      if(!['GET','POST','PUT','DELETE'].includes(method))throw new Error('Unsupported SDK request method');
      // A hosted build preview reaches Java only. A panel frame's requests are its declaration's, and in a candidate
      // preview they go to their owners marked with its build-test context: each owner admits or refuses them.
      if(execution.kind==='build-test'&&service!=='/data-query'&&!panel)throw Object.assign(new Error('This operation is not available for test-data preview'),{code:BUILD_TEST_UNSUPPORTED});
      const applicationId=publishedFrames.get(source);
      const isolated=typeof document!=='undefined'&&[...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===source&&frame.sandbox.contains('allow-scripts')&&!frame.sandbox.contains('allow-same-origin'));
      if(applicationId&&isolated){
        const response=await nodeApiRequest(`/api/product-assets/published/${encodeURIComponent(applicationId)}`);
        const publication=await response.json();if(!response.ok)throw new Error(publication.error?.message??'Application dependencies unavailable');
        const assets=publication.assets.map((asset:unknown)=>productAssetSchema.parse(asset));
        if(service===''){
          const readOnly=method==='GET',subscription=/^\/product-assets\/subscriptions(?:\/[^/?]+)?$/.test(path),collection=/^\/product-assets\/definitions\/[^/]+\/query$/.test(path),profileSession=/^\/product-assets\/[^/]+\/sessions$/.test(path);
          const conversation=/^\/assistant\/sessions(?:\/[^/?]+(?:\/(?:runs|events|messages|artifacts|tasks)(?:\/[^?]*)?)?)?(?:\?[^#]*)?$/.test(path);
          if(!readOnly&&!subscription&&!collection&&!profileSession&&!conversation)throw new Error('Published source applications cannot edit product or capability definitions');
          if(path.startsWith('/assistant/')&&!conversation&&path!=='/assistant/agents')throw new Error('Use the declared conversation interface');
          if(profileSession&&!assets.some((asset:ReturnType<typeof productAssetSchema.parse>)=>asset.id===decodeURIComponent(path.split('/')[2])&&asset.document.kind==='agent-profile'&&!publication.issues?.some((issue:{assetId:string})=>issue.assetId===asset.id)))throw new Error('AgentProfile is outside published dependencies');
        }
        if(service==='/data-query'){
          const body=init.body instanceof FormData?{id:init.body.get('id')}:typeof init.body==='string'?JSON.parse(init.body):{};
          const targetKind=path.startsWith('/action/')?'action':'metric';
          const contract=publication.contracts?.some((contract:{kind:string;id:string})=>contract.kind===targetKind&&contract.id===body.id);
          if(!contract||publication.issues?.some((issue:{assetId:string})=>{const asset=assets.find((asset:ReturnType<typeof productAssetSchema.parse>)=>asset.id===issue.assetId);return asset&&productReferences(asset.document).some(reference=>reference.kind===targetKind&&reference.id===body.id);} ))throw new Error('Capability is outside the published application dependency declaration or its contract changed');
        }
        if(service===''&&method==='POST'&&/^\/product-assets\/(?:definitions\/[^/]+\/query|subscriptions)$/.test(path)){
          const body=typeof init.body==='string'?JSON.parse(init.body):{};
          const trigger=body.kind==='trigger'?publication.triggers?.find((trigger:{id:string})=>trigger.id===body.id):undefined;
          if(body.kind==='trigger'&&(!trigger||!publication.contracts?.some((contract:{kind:string;id:string})=>contract.kind==='trigger'&&contract.id===body.id)))throw new Error('Trigger is outside published dependencies');
          const definitionId=path.includes('/definitions/')?decodeURIComponent(path.split('/')[3]):body.kind==='definition'?body.id:trigger?.definitionId;
          const projections=assets.filter((asset:ReturnType<typeof productAssetSchema.parse>)=>asset.document.kind==='collection-view'&&asset.document.renders.id===definitionId&&!publication.issues?.some((issue:{assetId:string})=>issue.assetId===asset.id));
          if(!definitionId||!projections.length)throw new Error('Subscription or collection is outside published dependencies or its contract changed');
          if(!trigger&&(!Array.isArray(body.fields)||!projections.some((asset:ReturnType<typeof productAssetSchema.parse>)=>asset.document.kind==='collection-view'&&body.fields.every((field:unknown)=>typeof field==='string'&&asset.document.kind==='collection-view'&&asset.document.fields.includes(field)))))throw new Error('Collection fields are outside the published projection');
        }
      }
      const assetRead=service===''&&method==='GET'?/^\/product-assets\/([^/?]+)$/.exec(path):null;
      const target=applicationId&&assetRead&&!['counts','types','query','home','projections','graph'].includes(assetRead[1])?`/product-assets/published/${encodeURIComponent(applicationId)}/${assetRead[1]}`:path;
      const headers=new Headers(init.headers);
      headers.delete(BUILD_TEST_HEADER);headers.delete('tk');headers.delete('authorization');headers.delete('x-api-key');
      if(!options.credential)throw new Error('Platform credential unavailable');
      if(options.credential.type==='token')headers.set('tk',options.credential.token);
      if(options.credential.type==='apiKey')headers.set('x-api-key',options.credential.apiKey);
      if(execution.kind==='build-test')headers.set(BUILD_TEST_HEADER,JSON.stringify({kind:'build-test',contextId:execution.contextId}));
      const response=await fetch(`${readRuntimeConfig().apiBase}${service}${target}`,{...init,headers,credentials:'omit'});
      return panel?relayToPanel(panel,method,path,service,response):response;
    },
    invalidateProductData(source,event){
      if(executionContext(source).kind!=='live'||!publishedFrames.has(source))throw new Error('Published application identity is required');
      if(typeof event.actionId!=='string'||!Array.isArray(event.objectTypes)||event.objectTypes.some(value=>typeof value!=='string'))throw new Error('Invalid Action invalidation event');
      invalidateProductData(event);
    },
    subscribeExecutionContext(source, listener) {
      executionContext(source);
      const listeners=executionListeners.get(source) ?? new Set();executionListeners.set(source,listeners);listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    credential: () => options.credential,
    subscribePreferences: (listener) => watch(current, (value) => listener(value)),
    navigate(path) {
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`Not a platform route: ${path}`);
      void options.router.push(path);
    },
    async navigateProduct(source,target){
      target=productNavigationTargetSchema.parse(target);
      if(executionContext(source).kind!=='live')throw new Error('Product navigation requires a published application');
      const applicationId=publishedFrames.get(source);
      if(!applicationId)throw new Error('Published application identity is required');
      const targetId='pageId' in target?target.pageId:target.objectViewId;
      const response=await nodeApiRequest(`/api/product-assets/published/${encodeURIComponent(applicationId)}/${encodeURIComponent(targetId)}`);
      const result=await response.json();
      if(!response.ok)throw new Error(result.error?.message??'Published page unavailable');
      const asset=productAssetSchema.parse(result.asset);
      let state:Record<string,unknown>;
      if('pageId' in target){
        validateProductNavigation(result.assets.map((item:unknown)=>productAssetSchema.parse(item)),target.pageId);
        if(asset.document.kind!=='page')throw new Error('Typed navigation requires a Page');
        state=validatePageState(asset.document.params??{},target.params);
      }else{
        if(asset.document.kind!=='object-projection')throw new Error('Instance navigation requires an ObjectView');
        state=validatePageState({selected:{kind:'object',objectType:asset.document.renders.id}},{selected:target.object});
      }
      await options.router.push({path:'/products/'+encodeURIComponent(targetId),query:{applicationId,state:JSON.stringify(state)}});
    },
    onAuthFailure: options.onAuthFailure,
    setPageContext(source, context) {
      for (const listener of pageContextListeners) listener(source, context);
    },
    subscribeFrameInsets(source, listener) {
      executionContext(source);
      const listeners = insetListeners.get(source) ?? new Set();
      insetListeners.set(source, listeners);
      listeners.add(listener);
      listener(frameInsets.get(source) ?? NO_INSETS);
      return () => { listeners.delete(listener); };
    },
  };
}
