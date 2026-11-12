import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import {
  platformScheduleApplicationsSchema,
  platformTaskSchema,
} from "@ontomato/contracts/platform-schedules";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { catalogFixture } from "./fixtures";
import { schedulePages } from "../workbench-routes";

/*
 * The platform's scheduled tasks page as the platform mounts it. What this guards is the assembly around the page: the
 * applications are named in the rail's words and order (the shell's partition), the requests go through the Node
 * request layer without doubling the contract's `/api/data-query`, a result opens through the router, and the agent
 * platform's old address lands on the agents filter.
 */
const requests: string[] = [];

installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});

const i18n = installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});

const RESULT = "/schedules?taskId=10000000-0000-4000-8000-000000000001&runId=30000000-0000-4000-8000-000000000001";
const task = platformTaskSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  creatorId: "member-a",
  title: "Nightly status check",
  appId: "ontology",
  content: { execution: "action:correct-status" },
  formRevision: "correct-status-sha256-v1",
  summary: [{ key: "execution", label: "Execute", value: "Correct leaver status" }],
  frequency: { kind: "daily", time: "23:00" },
  timeZone: "Asia/Shanghai",
  notifyEmail: null,
  enabled: true,
  pause: null,
  nextRunAt: "2026-11-06T15:00:00Z",
  revision: 1,
  createdAt: "2026-11-06T02:00:00Z",
  updatedAt: "2026-11-06T02:00:00Z",
  activeRunId: null,
  lastRun: null,
  latestResult: { runId: "30000000-0000-4000-8000-000000000001", link: { appId: "ontology", path: RESULT } },
});
/**
 * The service lists the applications in its own order; the page shows them in the rail's. Each holds a task, since the
 * filter row names only the applications that do.
 */
const applications = platformScheduleApplicationsSchema.parse({
  applications: ["governance", "operations", "agents", "ontology"].map((id) => ({
    id,
    description: null,
    available: true,
    unavailableReason: null,
    taskCount: 1,
  })),
  totalCount: 4,
});

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL, init?: { method?: string }) => {
    const url = String(input);
    requests.push(url);
    const path = new URL(url, "http://localhost").pathname;
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path.endsWith("/platform/applications")) return json(200, { success: true, data: catalogFixture() });
    if (path.endsWith("/credential/renew")) return json(204);
    if (path.endsWith("/scheduled-tasks/applications")) return json(200, applications);
    if (path.endsWith("/scheduled-tasks") && (init?.method ?? "GET") === "GET") return json(200, { tasks: [task], timeZone: "Asia/Shanghai" });
    return json(404, { error: { code: "TASK_NOT_FOUND", message: "Not found" }, correlationId: "test" });
  });
});

async function mountPlatform(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...schedulePages(), { path: "/agents/chat", component: defineComponent({ render: () => h("div") }) }],
  });
  const visited: string[] = [];
  router.afterEach((to) => void visited.push(to.fullPath));
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RouterView, {
    global: {
      plugins: [i18n, ElementPlus, router],
    },
  });
  await flushPromises();
  return { wrapper, router, visited };
}

describe("the platform's scheduled tasks page", () => {
  it("names the applications that can run on a schedule as the rail does, in its order", async () => {
    const { wrapper } = await mountPlatform("/schedules");

    expect(wrapper.text()).not.toContain("platformSchedules.");
    const railNames = catalogFixture()
      .filter((app) => ["ontology", "agents", "operations", "governance"].includes(app.id))
      .map((app) => app.names.en!);
    expect(wrapper.findAll(".chip").map((chip) => chip.findAll("span")[0]!.text())).toEqual(["All", ...railNames]);
    expect(wrapper.text()).toContain("Nightly status check");
    expect(requests.some((url) => url.includes("/data-query/platform/scheduled-tasks/credential/renew"))).toBe(true);
    expect(requests.every((url) => !url.includes("/api/data-query/api/data-query"))).toBe(true);
  });

  it("opens a result through the router", async () => {
    const { wrapper, visited } = await mountPlatform("/schedules");

    await wrapper.find(".card button.result").trigger("click");
    await flushPromises();

    expect(visited).toContain(RESULT);
  });

  it("sends the agent platform's old address to the agents filter", async () => {
    const { router } = await mountPlatform("/agents/schedules?agent=3f4b0d0e-1c2a-4f6e-9a0b-2d5c8e7f1a34");

    expect(router.currentRoute.value.fullPath).toBe("/schedules?app=agents");
    expect(requests.some((url) => url.endsWith("/data-query/platform/scheduled-tasks?appId=agents"))).toBe(true);
  });
});
