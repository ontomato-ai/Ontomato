import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, ref, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import type { Router } from "vue-router";
import { APP_HOST_GLOBAL, type AppHost } from "@ontomato/contracts/app-host";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { createManagerRequest, createMetricViewsClient } from "../../../../../ontology-manager/src/clients/index";
import { installAppHost, registerBuildPreview } from "../../../../../platform-web/src/app-host";
import { workbenchI18n } from "../../../i18n";
import PreviewTab from "../components/PreviewTab.vue";
import { builderPlatformKey, type AppBuilderPlatform } from "../platform";
import type { WorkspaceView } from "../workspace-view";

// Keep iframe browsing contexts real while leaving page content outside this component test.
vi.mock("../../../utils/api-base",()=>({API_BASE:"/api",apiUrl:(value:string)=>value.includes("/preview/") ? `about:blank#${encodeURIComponent(value)}` : `/api${value}`}));

const NOW=Date.UTC(2026,10,11,0,0,0);
let current: unknown=null;
let tokens=0;
const requests: Array<Record<string,string>>=[];
let wrapper: ReturnType<typeof mount>;
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}});
const context=(status:string,id="context-a")=>({contextId:id,workspaceId:"w1",status,expiresAt:NOW+3600000,classNames:["Material"],sampleSummary:{name:"test-data/sample.json",classes:1,sha256:"digest"},resources:[]});
beforeEach(()=>{
  vi.useFakeTimers({now:NOW,toFake:["setInterval","clearInterval","Date"]});current=null;tokens=0;requests.length=0;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    if(input.endsWith("/build-tests")) return json(current);
    if(input.endsWith("/preview-token")) return json({token:`token-${++tokens}`,expiresAt:""});
    if(input.endsWith("/metricView/queryById")) return json({success:true,data:{function:{parameters:[]}}});
    if(input.endsWith("/metricView/execute")) {requests.push(init!.headers as Record<string,string>);return json({success:true,data:[]});}
    throw new Error(`Unexpected request ${input}`);
  });
});
afterEach(()=>{wrapper?.unmount();vi.useRealTimers();vi.unstubAllGlobals();});
it("binds the actual iframe under controlled v-model across start, READY, replacement and reread",async()=>{
  installAppHost({credential:{type:"anonymous"},preferences:{locale:ref("en"),theme:ref("light")} as Parameters<typeof installAppHost>[0]["preferences"],
    router:{push:vi.fn()} as unknown as Router,onAuthFailure:vi.fn()});
  const host=(window as unknown as Record<string,AppHost>)[APP_HOST_GLOBAL]!;
  const platform={registerPreviewFrame:registerBuildPreview} as AppBuilderPlatform;
  const view=reactive({workspace:{id:"w1",headCommit:"head",activeRunId:null},files:[{path:"index.html",size:1}],filesState:"ready"}) as unknown as WorkspaceView;
  // A real parent-controlled model updates the prop on the next render, not during the child's emit.
  const Parent=defineComponent({setup(){const frameWindow=shallowRef<Window|null>(null);return ()=>h(PreviewTab,{view,reload:0,flash:null,frameWindow:frameWindow.value,"onUpdate:frameWindow":(value:Window|null)=>{frameWindow.value=value;}});}});
  wrapper=mount(Parent,{attachTo:document.body,global:{plugins:[ElementPlus,workbenchI18n()],provide:{[builderPlatformKey as symbol]:platform}}});
  await flushPromises();
  const frame=()=>wrapper.get("iframe").element as HTMLIFrameElement;
  const initial=frame().contentWindow!;expect(initial).not.toBeNull();
  expect(host.executionContext(initial)).toMatchObject({kind:"build-test",contextId:null});
  current=context("PREPARING");await vi.advanceTimersByTimeAsync(5000);await flushPromises();
  expect(host.executionContext(frame().contentWindow!)).toMatchObject({kind:"build-test",contextId:"context-a",status:"PREPARING"});
  current=context("READY");await vi.advanceTimersByTimeAsync(5000);await flushPromises();
  const ready=frame().contentWindow!;expect(host.executionContext(ready)).toMatchObject({contextId:"context-a",status:"READY"});
  current=context("READY","context-b");await vi.advanceTimersByTimeAsync(5000);await flushPromises();
  const replaced=frame().contentWindow!;expect(replaced).not.toBe(ready);
  expect(host.executionContext(ready)).toMatchObject({contextId:"context-a"});
  expect(host.executionContext(replaced)).toMatchObject({contextId:"context-b"});
  const request=createManagerRequest({apiBase:"/api",credential:{type:"anonymous"},locale:"en",text:key=>key,
    get executionContext(){return host.executionContext(replaced);}},()=>{});
  const client=createMetricViewsClient(request);
  const button=replaced.document.createElement("button");button.textContent="重新读取";
  button.addEventListener("click",()=>{void client.read({id:"metric",parameters:{}});});replaced.document.body.append(button);
  button.click();await flushPromises();
  expect(requests).toHaveLength(1);expect(JSON.parse(requests[0]![BUILD_TEST_HEADER]!)).toEqual({kind:"build-test",contextId:"context-b"});
});
