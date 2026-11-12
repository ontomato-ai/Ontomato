import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { openApplicationKey } from "../apps";
import Workspace from "../pages/PersonalWorkspaceRoute.vue";

const api = vi.hoisted(() => ({ request: vi.fn(), failTasks: false, failSave: false, saved: null as unknown, tasks: [] as unknown[], recent: [] as unknown[] }));
vi.mock("@ontomato/workbench-ui", () => ({ nodeApiRequest: api.request }));
vi.mock("@ontomato/workbench-ui/features/dashboard", () => ({ DashboardCardPicker: { template: '<div />' }, DashboardMetricDetail: { template: '<div>Live metric details</div>' }, DashboardMetricPreview: { name: "DashboardMetricPreview", props: ["dashboardId", "revision"], template: '<div class="metric-preview-stub">{{ dashboardId }}<button class="select-metric" @click="$emit(\'select\', {id: \'card-a\', name: \'Revenue\'})">Revenue</button></div>' } }));

const application = { id: "app-orders", kind: "hosted", category: "business", names: { en: "Orders" }, descriptions: {}, icon: "pages", rail: "apps", sort: 0, entry: { path: "/orders" }, entryAccess: ["orders"], scheduleAdapter: null, releaseId: "release" };
beforeEach(() => {
  api.failTasks = false;
  api.failSave = false;
  api.saved = null;
  api.tasks = [];
  api.recent = [];
  api.request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes("scheduled-tasks")) {
      if (api.failTasks) throw new Error("Task service unavailable");
      return Response.json({ tasks: api.tasks, timeZone: "UTC" });
    }
    if (path.includes("platform/applications")) return Response.json({ success: true, data: [application] });
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
async function page() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/workspace", component: Workspace }, { path: "/dashboards", component: { template: "<div />" } },
  ] });
  await router.push("/workspace");
  const open = vi.fn();
  const wrapper = mount(Workspace, { global: {
    plugins: [router, ElementPlus, createI18n({ legacy: false, locale: "en", messages: { en: {} } })],
    provide: { [openApplicationKey as symbol]: open },
  } });
  await flushPromises();
  return { wrapper, router, open };
}
describe("personal workspace", () => {
  it("opens metric details beside the workspace and can switch to a dialog", async () => {
    const { wrapper, router } = await page();
    await wrapper.find('.select-metric').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/workspace');
    expect(wrapper.findComponent({ name: 'ElDrawer' }).props('modelValue')).toBe(true);
    const toolbar = wrapper.find('.resource-toolbar');
    await toolbar.findAll('button').find(button => button.text() === 'Dialog')!.trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue') === true)).toBe(true);
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
    const task = (title: string, extra = {}) => ({ id: crypto.randomUUID(), title, appId: "agents", content: {}, formRevision: "1", frequency: { kind: "daily", time: "09:00" }, timeZone: "UTC", notifyEmail: null,
      creatorId: "alice", summary: [], enabled: true, pause: null, nextRunAt: null, revision: 1, createdAt: now, updatedAt: now, activeRunId: null, lastRun: null, latestResult: null, ...extra });
    const reportId = crypto.randomUUID();
    const runId = crypto.randomUUID();
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
    wrapper.unmount();
  });
  it("opens selected resources through the platform and preserves other sections when tasks fail", async () => {
    api.failTasks = true;
    const { wrapper, router, open } = await page();
    expect(wrapper.text()).toContain("Task service unavailable");
    const applicationLink = wrapper.find('a.application-card');
    expect(applicationLink.attributes('href')).toBe('/applications/app-orders');
    expect(applicationLink.attributes('target')).toBe('_blank');
    expect(applicationLink.attributes('rel')).toBe('noopener');
    expect(open).not.toHaveBeenCalled();
    await wrapper.findAll("button").find(button => button.text() === "Sales")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/dashboards?dashboardId=board-a");
    wrapper.unmount();
  });
  it("keeps the settings open on failed saves and persists the draft on retry", async () => {
    const { wrapper } = await page();
    await wrapper.findAll("button").find(button => button.text() === "Configure workspace")!.trigger("click");
    await flushPromises();
    api.failSave = true;
    const save = () => wrapper.findAll("button").find(button => button.text() === "Save")!;
    await save().trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Save failed");
    expect(api.saved).toBeNull();
    api.failSave = false;
    await save().trigger("click");
    await flushPromises();
    expect(api.saved).toEqual({ ...defaultPersonalWorkspace(), dashboardIds: ["board-a"], applicationIds: ["app-orders"] });
    wrapper.unmount();
  });
});
