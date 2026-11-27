import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { APP_HOST_GLOBAL, type AppHost } from "@ontomato/contracts/app-host";
import { previewExecutionContextValue,EXECUTION_CONTEXT_HEADER } from "@ontomato/contracts/execution-context";
import { installAppHost, registerBuildPreview, registerLiveFrame } from "../app-host";
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
    await expect(host().request!(source,'/business-definitions/../admin/delete',{},'')).rejects.toThrow('Invalid SDK request');
  });
  it("reads only the exact vector resource through the live frame host", async () => {
    installAppHost({
      credential: { type: "token", token: "current-domain" },
      preferences: { locale: ref("en"), theme: ref("light") } as PlatformPreferences,
      router: createRouter({ history: createMemoryHistory(), routes: [] }),
      onAuthFailure: vi.fn(),
    });
    const source = frame();
    registerLiveFrame(source, "published");
    const preview = frame();
    registerBuildPreview(preview, previewExecutionContextValue);
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("attachment"));
    const path = "/vectorResource/resource/vector-Order-proof-domain/file.pdf";
    const response = await host().request!(source, path, { method: "GET", headers: { tk: "forged" } }, "/data-query");
    expect(await response.text()).toBe("attachment");
    expect(String(request.mock.calls[0]![0]).endsWith(`/data-query${path}`)).toBe(true);
    expect(new Headers(request.mock.calls[0]![1]?.headers).get("tk")).toBe("current-domain");
    expect(request.mock.calls[0]![1]?.redirect).toBe("error");
    await expect(host().request!(preview, path, { method: "GET" }, "/data-query")).rejects.toThrow("declared SDK capability");
    await expect(host().request!(source, path, { method: "POST" }, "/data-query")).rejects.toThrow("declared SDK capability");
    await expect(host().request!(source, `${path}/extra`, { method: "GET" }, "/data-query")).rejects.toThrow("declared SDK capability");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('marks only the business-data write a preview frame sends, from the registered frame rather than the source headers',async()=>{
    const source=frame();const context=previewExecutionContextValue;registerBuildPreview(source,context);
    const request=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({success:true,data:[]}));
    await host().request!(source,'/action/execute',{method:'POST',headers:{[EXECUTION_CONTEXT_HEADER]:'forged',tk:'forged'},body:'{}'},'/data-query');
    const headers=new Headers(request.mock.calls[0][1]?.headers);
    expect(headers.get(EXECUTION_CONTEXT_HEADER)).toBe(JSON.stringify({kind:'preview'}));
    expect(headers.has('tk')).toBe(false);
    // A read and a definition write are the caller's own: no preview identity is claimed for them.
    request.mockClear();
    await host().request!(source,'/metricView/execute',{method:'POST',body:'{}'},'/data-query');
    expect(new Headers(request.mock.calls[0][1]?.headers).has(EXECUTION_CONTEXT_HEADER)).toBe(false);
    request.mockClear();
    await host().request!(source,'/business-definitions',{method:'POST',body:'{}'},'');
    expect(new Headers(request.mock.calls[0][1]?.headers).has(EXECUTION_CONTEXT_HEADER)).toBe(false);
  });
  it('opens a conversation from a build preview as the preview, and leaves an agent definition write unmarked and unrefused',async()=>{
    const source=frame();registerBuildPreview(source,previewExecutionContextValue);
    const request=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({success:true,data:[]}));
    const marker=async(path:string)=>{
      request.mockClear();
      await expect(host().request!(source,path,{method:'POST',body:'{}'},'')).resolves.toBeInstanceOf(Response);
      expect(request).toHaveBeenCalledTimes(1);
      return new Headers(request.mock.calls[0][1]?.headers).get(EXECUTION_CONTEXT_HEADER);
    };
    // The conversation and each of its runs are the preview's, so what they execute is refused where it is executed.
    expect(await marker('/assistant/sessions')).toBe(JSON.stringify({kind:'preview'}));
    expect(await marker('/assistant/sessions/8f5df4a4-e30b-48cb-831a-33b759144f76/runs')).toBe(JSON.stringify({kind:'preview'}));
    expect(await marker('/assistant/agent-definitions')).toBeNull();
    // A live frame's conversation runs live.
    const live=frame();registerLiveFrame(live,'published');
    request.mockClear();
    await host().request!(live,'/assistant/sessions',{method:'POST',body:'{}'},'');
    expect(new Headers(request.mock.calls[0][1]?.headers).has(EXECUTION_CONTEXT_HEADER)).toBe(false);
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
  it("keeps preview bindings preview and requires a new frame to change kinds",()=>{
    const source=frame(),initial=previewExecutionContextValue;
    const registration=registerBuildPreview(source,initial),changed=vi.fn();
    const stop=host().subscribeExecutionContext(source,changed);
    expect(host().executionContext(source)).toEqual(initial);
    registration.update({...initial});expect(changed).toHaveBeenCalledOnce();
    expect(()=>registration.update({kind:"live"})).toThrow("Reload");
    expect(()=>registerLiveFrame(source)).toThrow("Reload");
    expect(host()).not.toHaveProperty("registerLiveFrame");
    stop();registration.dispose();expect(host().executionContext(source).kind).toBe("preview");
  });
});
