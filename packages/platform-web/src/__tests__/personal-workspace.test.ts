import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { randomId } from "@ontomato/contracts/random-id";
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import { openApplicationKey } from "../apps";
import Workspace from "../pages/PersonalWorkspaceRoute.vue";

const api = vi.hoisted(() => ({ request: vi.fn(), failTasks: false, failSave: false, saved: null as unknown, tasks: [] as unknown[], recent: [] as unknown[], conversations: [] as unknown[] }));
vi.mock("@ontomato/workbench-ui", () => ({ nodeApiRequest: api.request, readRememberedAgent: () => null }));
vi.mock("@ontomato/agent-shell-ui", () => ({ AgentPicker: { template: '<div />' }, ShellComposer: { name: "ShellComposer", template: '<div><slot name="tools" /></div>' } }));
vi.mock("@ontomato/workbench-ui/features/dashboard", () => ({ DashboardCardPicker: { template: '<div />' }, DashboardMetricDetail: { template: '<div>Live metric details</div>' }, DashboardMetricPreview: { name: "DashboardMetricPreview", props: ["dashboardId", "revision"], template: '<div class="metric-preview-stub">{{ dashboardId }}<button class="select-metric" @click="$emit(\'select\', {id: \'card-a\', name: \'Revenue\'})">Revenue</button></div>' } }));

const application = { id: "app-orders", kind: "hosted", category: "business", names: { en: "Orders" }, descriptions: {}, icon: "pages", rail: "apps", sort: 0, entry: { path: "/orders" }, entryAccess: ["orders"], scheduleAdapter: null, releaseId: "release" };
const workspace=()=>({...defaultPersonalWorkspace(),dashboardIds:['board-a'],applicationIds:['app-orders']});
const blocks=()=>['assistant','apps','data','tasks','recent','conversations'].map(source=>productAssetSchema.parse({id:source,name:source,ownerId:'alice',visibility:'private',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),editable:true,document:{kind:'widget',widget:{kind:'platform',source}}}));
const home=()=>productAssetSchema.parse({id:'home',name:'Home',ownerId:'alice',visibility:'private',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),editable:true,document:{kind:'page',compositionVersion:2,workspace:workspace(),children:blocks().map(block=>({assetId:block.id,column:'main'}))}});
beforeEach(() => {
  api.failTasks = false;
  api.failSave = false;
  api.saved = null;
  api.tasks = [];
  api.recent = [];
  api.conversations = [];
  api.request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if(path==='/api/product-assets/home'&&init?.method==='PUT'){
      if(api.failSave)throw new Error('Save failed');
      const input=JSON.parse(String(init.body));api.saved=input.document.workspace;
      return Response.json({asset:{...home(),...input,revision:2}});
    }
    if(path==='/api/product-assets/home')return Response.json({asset:home()});
    if(path==='/api/product-assets')return Response.json({assets:blocks()});
    if (path.includes("scheduled-tasks")) {
      if (api.failTasks) throw new Error("Task service unavailable");
      return Response.json({ tasks: api.tasks, timeZone: "UTC" });
    }
    if (path.includes("platform/applications")) return Response.json({ success: true, data: [application, { ...application, id: "agents", kind: "native", entry: { path: "/agents", renderer: "agents" } }] });
    if (path.endsWith("/assistant/agents")) return Response.json({ agents: [{ id: "11111111-1111-4111-8111-111111111111", name: "Analyst", enabled: true, description: "Analyze data", icon: null }] });
    if (path.endsWith("/platform/home")) return Response.json({ favorites: [], dashboardIds: [], recentApplications: [], recentConversations: api.conversations });
    if (path.includes('/assistant/sessions/')) return Response.json({ session: { id: "22222222-2222-4222-8222-222222222222", agentId: "11111111-1111-4111-8111-111111111111", title: "Faculty", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), latestRun: null }, messages: [], latestRun: null });
    if (path.includes("dashboards")) return Response.json({ data: [{ id: "board-a", name: "Sales" }] });
    if (path.endsWith("/recent")) return Response.json({ data: api.recent });
    if (init?.method === "PUT") {
      if (api.failSave) throw new Error("Save failed");
      api.saved = JSON.parse(String(init.body));
      return Response.json({ data: api.saved });
    }
    return Response.json({ data: { ...defaultPersonalWorkspace(), dashboardIds: ["board-a"], applicationIds: ["app-orders"] } });
  });
});
async function page(stubs: Record<string, boolean> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/workspace", component: Workspace }, { path: "/dashboards", component: { template: "<div />" } }, { path: "/agents/chat", component: { template: "<div />" } },
  ] });
  await router.push("/workspace");
  const open = vi.fn();
  const wrapper = mount(Workspace, { global: {
    stubs,
    plugins: [router, ElementPlus, createI18n({ legacy: false, locale: "en", messages: { en: {} } })],
    provide: { [openApplicationKey as symbol]: open },
  } });
  await flushPromises();
  return { wrapper, router, open };
}
describe("personal workspace", () => {
  it('renders the same platform component outside a home using its own resource selection',async()=>{
    const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<div />'}}]});
    await router.push('/');
    const asset=productAssetSchema.parse({...blocks()[1],document:{kind:'widget',widget:{kind:'platform',source:'apps',workspace:workspace()}}});
    const wrapper=mount(Workspace,{props:{platformWidgetAsset:asset,preview:true},global:{plugins:[router,ElementPlus,createI18n({legacy:false,locale:'en',messages:{en:{}}})],provide:{[openApplicationKey as symbol]:vi.fn()}}});
    await flushPromises();
    expect(wrapper.find('a.application-card').text()).toContain('Orders');
    expect(api.request.mock.calls.some(([path])=>path==='/api/product-assets/home')).toBe(false);
    expect(wrapper.find('.platform-page-header').exists()).toBe(false);
    wrapper.unmount();
  });
  it('does not synthesize workspace sections when the page composition is empty',async()=>{
    const previous=api.request.getMockImplementation()!;
    api.request.mockImplementation((path:string,init?:RequestInit)=>path==='/api/product-assets/home'&&!init?.method?Promise.resolve(Response.json({asset:{...home(),document:{...home().document,children:[]}}})):previous(path,init));
    const {wrapper}=await page();
    expect(wrapper.findComponent({name:'ShellComposer'}).exists()).toBe(false);
    expect(wrapper.find('[data-section]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('allows configuration while unrelated task loading is still pending',async()=>{
    const previous=api.request.getMockImplementation()!;
    let finish!:(value:Response)=>void;
    api.request.mockImplementation((path:string,init?:RequestInit)=>path.includes('scheduled-tasks')?new Promise<Response>(resolve=>{finish=resolve;}):previous(path,init));
    // Select popup rendering is outside this contract (the dialog opening while tasks load) and exceeds CI's timeout.
    const {wrapper}=await page({ElSelect:true});
    const configure=wrapper.findAll('button').find(button=>button.text()==='Configure workspace')!;
    expect(configure.attributes('disabled')).toBeUndefined();
    await configure.trigger('click');await flushPromises();
    expect(wrapper.findComponent({name:'ElDialog'}).props('modelValue')).toBe(true);
    finish(Response.json({tasks:[],timeZone:'UTC'}));await flushPromises();wrapper.unmount();
  });
  it("pins an accessible analysis and removes it from the recent list without duplicating it", async () => {
    api.conversations = [{ sessionId: "22222222-2222-4222-8222-222222222222", agentId: "11111111-1111-4111-8111-111111111111", title: "Faculty analysis", updatedAt: new Date().toISOString() }];
    const { wrapper } = await page();
    await wrapper.find('.pin-analysis').trigger('click');
    await flushPromises();
    expect(api.saved).toMatchObject({ pinnedAnalyses: [{ sessionId: "22222222-2222-4222-8222-222222222222", title: "Faculty analysis" }] });
    expect(wrapper.findAll('.pinned-analysis')).toHaveLength(1);
    expect(wrapper.findAll('.conversation-item')).toHaveLength(0);
    wrapper.find('.pinned-analysis').findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'unpin');
    await flushPromises();
    expect(wrapper.findAll('.pinned-analysis')).toHaveLength(0);
    expect(wrapper.findAll('.conversation-item')).toHaveLength(1);
    wrapper.unmount();
  });
  it("starts a question with the selected agent without adding scope or hidden context", async () => {
    const { wrapper, router } = await page();
    const composer = wrapper.findComponent({ name: "ShellComposer" });
    expect(composer.exists()).toBe(true);
    composer.vm.$emit('send', 'Explain the revenue');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/agents/chat');
    expect(router.currentRoute.value.query.agentId).toBe('11111111-1111-4111-8111-111111111111');
    expect(router.currentRoute.value.query.prompt).toBe('Explain the revenue');
    expect(api.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    wrapper.unmount();
  });
  it("opens metric details beside the workspace without starting an analysis", async () => {
    const { wrapper, router } = await page();
    await wrapper.find('.select-metric').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/workspace');
    expect(wrapper.findAllComponents({ name: 'ElDrawer' }).some(drawer => drawer.props('modelValue') === true)).toBe(true);
    expect(api.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    wrapper.unmount();
  });
  it("resumes accessible work and refreshes the saved dashboard's metric preview", async () => {
    api.recent = [
      { appId: "app-orders", title: "Orders", path: "/applications/app-orders", visitedAt: new Date().toISOString() },
      { appId: "removed", title: "Removed app", path: "/applications/removed", visitedAt: new Date().toISOString() },
    ];
    const { wrapper } = await page();
    for (const section of ["apps", "data", "tasks", "recent"])
      expect(wrapper.find(`[data-section="${section}"]`).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Removed app");
    const preview = wrapper.findComponent({ name: "DashboardMetricPreview" });
    const revision = preview.props("revision");
    await wrapper.findAll("button").find(button => button.text() === "Refresh")!.trigger("click");
    await flushPromises();
    expect(wrapper.findComponent({ name: "DashboardMetricPreview" }).props("revision")).toBe(revision + 1);
    wrapper.unmount();
  });
  it("prioritizes intervention and recent results while leaving normal schedules in the task application", async () => {
    const now = new Date().toISOString();
    const task = (title: string, extra = {}) => ({ id: randomId(), title, appId: "agents", content: {}, formRevision: "1", frequency: { kind: "daily", time: "09:00" }, timeZone: "UTC", notifyEmail: null,
      creatorId: "alice", summary: [], enabled: true, pause: null, nextRunAt: null, revision: 1, createdAt: now, updatedAt: now, activeRunId: null, lastRun: null, latestResult: null, ...extra });
    const reportId = randomId();
    const runId = randomId();
    api.tasks = [task("Normal schedule"), task("Paused schedule", { pause: { code: "permission_denied", message: "Access changed" } }), task("Report ready", {
      id: reportId,
      lastRun: { id: runId, taskId: reportId, trigger: "schedule", status: "completed", scheduledAt: now, startedAt: now, finishedAt: now, error: null, resultSummary: "Report generated", resultLink: { appId: "agents", path: "/agents/chat?sessionId=report" }, spendTime: 10 },
      latestResult: { runId, link: { appId: "agents", path: "/agents/chat?sessionId=report" } },
    })];
    const { wrapper } = await page();
    expect(wrapper.text()).toContain("Access changed");
    expect(wrapper.text()).toContain("Report generated");
    expect(wrapper.text()).not.toContain("Normal schedule");
    expect(wrapper.find('[data-section="tasks"]').findAll(".workspace-item")[0]!.text()).toContain("Paused schedule");
    await wrapper.find('[data-task-group="issues"] .resource-link').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents({ name: 'ElDrawer' }).some(drawer => drawer.props('modelValue') === true)).toBe(true);
    expect(wrapper.findComponent({ name: 'WorkspaceResourceDetail' }).props('resource')).toMatchObject({ pauseMessage: 'Access changed', runId: null });
    wrapper.unmount();
  });
  it("opens selected resources through the platform and preserves other sections when tasks fail", async () => {
    api.failTasks = true;
    const { wrapper, router, open } = await page();
    expect(wrapper.text()).toContain("Task service unavailable");
    const applicationLink = wrapper.find('a.application-card');
    expect(applicationLink.attributes('href')).toBe('/applications/app-orders');
    await applicationLink.trigger('click');
    expect(open).toHaveBeenCalledWith('app-orders');
    await wrapper.find('.board-link').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/dashboards?dashboardId=board-a");
    wrapper.unmount();
  });
  it("keeps the settings open on failed saves and persists the draft on retry", async () => {
    // Select popup rendering is outside the save/retry contract.
    const { wrapper } = await page({ ElSelect: true });
    await wrapper.findAll("button").find(button => button.text() === "Configure workspace")!.trigger("click");
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "ElDialog" });
    const layout = dialog.findComponent({ name: "ElSelect" });
    layout.vm.$emit("update:modelValue", "tasks");
    layout.vm.$emit("change", "tasks");
    await flushPromises();
    api.failSave = true;
    const save = () => wrapper.findAll("button").find(button => button.text() === "Save")!;
    await save().trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Save failed");
    expect(api.saved).toBeNull();
    expect(dialog.props("modelValue")).toBe(true);
    expect(layout.props("modelValue")).toBe("tasks");
    api.failSave = false;
    await save().trigger("click");
    await flushPromises();
    expect(api.saved).toEqual({ ...defaultPersonalWorkspace(), layout: "tasks", dashboardIds: ["board-a"], applicationIds: ["app-orders"], sections: { main: ["tasks", "data"], sidebar: ["conversations", "objects", "apps", "recent"], hidden: [] } });
    expect(dialog.props("modelValue")).toBe(false);
    wrapper.unmount();
  });
});
