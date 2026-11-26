import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref,createApp } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { APP_HOST_GLOBAL, type AppHost } from "@ontomato/contracts/app-host";
import { buildExecutionContext,BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { installAppHost,installProductEmbedding, registerBuildPreview, registerLiveFrame } from "../app-host";
import ApplicationRoute from "../pages/ApplicationRoute.vue";
import {installAuthHost} from '@ontomato/workbench-ui/utils/auth';
vi.mock('@ontomato/workbench-ui',async original=>({...await original<object>(),nodeApiRequest:async()=>Response.json({messageBridge:0})}));

const elements:HTMLIFrameElement[]=[];
let route:ReturnType<typeof mount>|undefined;
function frame() {const element=document.createElement("iframe");document.body.append(element);elements.push(element);return element.contentWindow!;}
function host() {return (window as unknown as Record<string,AppHost>)[APP_HOST_GLOBAL]!;}
beforeEach(()=>{
  installAuthHost({getToken:()=>null,getApiKey:()=>null,getUserInfo:()=>null,responseStatusError:()=>null,verifySessionOnce:async()=>'valid',handleAuthExpired:()=>{}});
  installAppHost({credential:{type:"anonymous"},preferences:{locale:ref("en"),theme:ref("light")} as PlatformPreferences,
    router:createRouter({history:createMemoryHistory(),routes:[]}),onAuthFailure:vi.fn()});
});
afterEach(()=>{route?.unmount();route=undefined;elements.splice(0).forEach(element=>element.remove());vi.restoreAllMocks();});
describe("explicit frame execution bindings",()=>{
  it('rejects arbitrary platform transports through the SDK host',async()=>{
    const source=frame();registerLiveFrame(source,'published');
    await expect(host().request!(source,'/dsl/executeV1',{method:'POST'},'/data-query')).rejects.toThrow('declared SDK capability');
    await expect(host().request!(source,'/admin/delete',{method:'POST'},'')).rejects.toThrow('declared SDK product');
    await expect(host().request!(source,'//other-host/path',{},'/data-query')).rejects.toThrow('Invalid SDK request');
    await expect(host().request!(source,'/product-assets/../admin/delete',{},'')).rejects.toThrow('Invalid SDK request');
  });
  it('derives preview execution headers from the registered frame rather than trusting source headers',async()=>{
    const source=frame();const context=buildExecutionContext('workspace',null);registerBuildPreview(source,context);
    const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({success:true,data:[]}));
    await host().request!(source,'/metricView/execute',{method:'POST',headers:{[BUILD_TEST_HEADER]:'forged',tk:'forged'},body:'{}'},'/data-query');
    const headers=new Headers(request.mock.calls[0][1]?.headers);
    expect(headers.get(BUILD_TEST_HEADER)).toBe(JSON.stringify({kind:'build-test',contextId:context.contextId}));
    expect(headers.has('tk')).toBe(false);
  });
  it('keeps a hosted build preview off Node: its product request is refused here, with the preview refusal code',async()=>{
    const source=frame();registerBuildPreview(source,buildExecutionContext('workspace',null));
    const request=vi.spyOn(globalThis,'fetch');
    await expect(host().request!(source,'/assistant/sessions',{method:'POST',body:'{}'},'')).rejects.toMatchObject({code:'BUILD_TEST_UNSUPPORTED'});
    expect(request).not.toHaveBeenCalled();
  });
  it('removes the published application identity when its frame is disposed',()=>{
    const source=frame();const dispose=registerLiveFrame(source,'published');
    installProductEmbedding(createApp({template:'<div />'}));
    dispose();const element=(source as Window).document.createElement('div');
    expect(()=>host().mountProductAsset!(source,element,'page')).toThrow('Published application identity');
  });
  it('rejects product embedding for unregistered and build-test frames before mounting content',()=>{
    const source=frame();const app=createApp({template:'<div />'});installProductEmbedding(app);
    const element=(source as Window).document.createElement('div');
    expect(()=>host().mountProductAsset!(source,element,'shared')).toThrow('not registered');
    const binding=registerBuildPreview(source,buildExecutionContext('workspace',null));
    expect(()=>host().mountProductAsset!(source,element,'shared')).toThrow('build-test');
    expect(element.shadowRoot).toBeNull();binding.dispose();
  });
  it('rejects mounting into a container outside the registered source frame',()=>{
    const source=frame();registerLiveFrame(source);installProductEmbedding(createApp({template:'<div />'}));
    expect(()=>host().mountProductAsset!(source,document.createElement('div'),'shared')).toThrow('registered app frame');
  });
  it("throws for unregistered frames instead of selecting live",()=>{
    const source=frame();
    expect(()=>host().executionContext(source)).toThrow("not registered");
    expect(()=>host().subscribeExecutionContext(source,vi.fn())).toThrow("not registered");
  });
  it("registers the connected ApplicationRoute frame as live before starting navigation",async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({messageBridge:0}));
    const router=createRouter({history:createMemoryHistory(),routes:[{path:"/applications/:applicationId",component:ApplicationRoute}]});
    await router.push("/applications/connected");await router.isReady();
    vi.spyOn(HTMLIFrameElement.prototype,"src","set").mockImplementation(function(this:HTMLIFrameElement,value:string){
      expect(value).toContain("/apps/connected/");
      expect(host().executionContext(this.contentWindow!)).toEqual({kind:"live"});
      // Keep a real browsing context without contacting a local backend.
      this.setAttribute("src","about:blank");
    });
    route=mount(ApplicationRoute,{attachTo:document.body,global:{plugins:[router]}});await flushPromises();
    const element=route.get("iframe").element as HTMLIFrameElement;
    expect(host().executionContext(element.contentWindow!)).toEqual({kind:"live"});
  });
  it("keeps preview bindings build-test and requires a new frame to change targets",()=>{
    const source=frame(),initial=buildExecutionContext("workspace",null);
    const registration=registerBuildPreview(source,initial),changed=vi.fn();
    const stop=host().subscribeExecutionContext(source,changed);
    expect(host().executionContext(source)).toEqual(initial);
    registration.update({...initial,status:"PREPARING"});expect(changed).toHaveBeenCalledOnce();
    expect(()=>registration.update({...initial,contextId:"new-context"})).toThrow("Reload");
    expect(()=>registerLiveFrame(source)).toThrow("Reload");
    expect(host()).not.toHaveProperty("registerLiveFrame");
    stop();registration.dispose();expect(host().executionContext(source).kind).toBe("build-test");
  });
});
