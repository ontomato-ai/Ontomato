import { afterEach, describe, expect, it } from "vitest";
import type { DOMWrapper, VueWrapper } from "@vue/test-utils";
import { platformScheduleApplicationsSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import PlatformSchedulesPage from "../pages/PlatformSchedulesPage.vue";
import ScheduleCard from "../components/ScheduleCard.vue";
import ScheduleRunsDrawer from "../components/ScheduleRunsDrawer.vue";
import {
  BASE,
  HOST_APPS,
  applications,
  deferred,
  dropped,
  fakeHost,
  flushPromises,
  mount,
  pageGlobal,
  refusal,
  run,
  summaryOf,
  task,
  text,
  type Answer,
  type Call,
} from "./fixtures";

const governance = task("governance-instruction", {
  pause: { code: "definition_changed", message: "The function it runs was changed" },
  nextRunAt: null,
});
const completedOntologyRun = run("ontology-completed-with-resolved-parameters");
const ontology = task("ontology-with-line-arrays", {
  lastRun: summaryOf(
    run("ontology-completed-with-resolved-parameters", {
      id: "30000000-0000-4000-8000-00000000000a",
      status: "failed",
      error: { code: "permission_denied", message: "You can no longer execute this action" },
      resultSummary: null,
      resultLink: null,
    }),
  ),
  latestResult: { runId: completedOntologyRun.id, link: completedOntologyRun.resultLink! },
});
const operations = task("operations-autotest");
const runningAgentRun = run("agents-running");
const agents = task("agents-instruction", { lastRun: summaryOf(runningAgentRun), activeRunId: runningAgentRun.id });
/**
 * The service's order: what needs attention first, then by next run. The two scheduled tasks come in an order no
 * client-side sort would give them (the later next run first, titles out of order), so a page that sorted would show it.
 */
const listed = [governance, ontology, operations, agents];

let mounted: VueWrapper[] = [];
afterEach(() => {
  mounted.forEach((wrapper) => wrapper.unmount());
  mounted = [];
});

/** A service with the caller's four tasks; `answer` takes any request a test wants to answer itself. */
function service(answer: (call: Call) => Answer | Promise<Answer> | undefined = () => undefined) {
  return fakeHost(async (call) => {
    const own = await answer(call);
    if (own) return own;
    if (call.path === `${BASE}/credential/renew`) return { status: 204 };
    if (call.path === `${BASE}/applications`) return { status: 200, body: applications() };
    if (call.method === "GET" && call.path.startsWith(BASE) && !call.path.slice(BASE.length).startsWith("/")) {
      return { status: 200, body: { tasks: listed, timeZone: "Asia/Shanghai" } };
    }
    if (call.method === "GET" && call.path.endsWith("/runs")) return { status: 200, body: { runs: [], nextCursor: null } };
    throw new Error(`Unexpected ${call.method} ${call.path}`);
  });
}

async function mountPage(host: ReturnType<typeof service>["host"], props: Record<string, unknown> = {}) {
  const wrapper = mount(PlatformSchedulesPage, { props: { host, ...props }, global: pageGlobal() });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const titles = (wrapper: VueWrapper) => wrapper.findAll(".card .title").map((title) => title.text());
/** A filter as read: the application's name and its count. */
const parts = (chip: DOMWrapper<Element>) => chip.findAll("span").map((part) => part.text()).join(" ");
const chipTexts = (wrapper: VueWrapper) => wrapper.findAll(".chip").map(parts);
const chipApps = (wrapper: VueWrapper) => wrapper.findAll(".chip").map((chip) => chip.attributes("data-app"));
const card = (wrapper: VueWrapper, item: PlatformTask) =>
  wrapper.findAllComponents(ScheduleCard).find((found) => found.props("task").id === item.id)!;

describe("the scheduled tasks page", () => {
  it("renews the credential, then shows the service's cards in the service's order", async () => {
    const { host, calls } = service();
    const wrapper = await mountPage(host);

    expect(calls[0]!.path).toBe(`${BASE}/credential/renew`);
    expect(calls.slice(1).map((call) => call.path).sort()).toEqual([BASE, `${BASE}/applications`]);
    expect(titles(wrapper)).toEqual(listed.map((item) => item.title));

    // A card shows what it was given as the application summarised it, why it is paused, and its last run.
    expect(text(card(wrapper, ontology))).toContain("离职状态校正");
    expect(text(card(wrapper, ontology))).toContain("销售部、市场部");
    expect(text(card(wrapper, ontology))).toContain("Failed");
    expect(text(card(wrapper, ontology))).toContain("You can no longer execute this action");
    expect(text(card(wrapper, governance))).toContain("The function it runs was changed");
    expect(text(card(wrapper, governance))).toContain("Every Monday at 09:00");
    expect(text(card(wrapper, agents))).toContain("Running");
  });

  it("keeps a card where it stands when its answer changes", async () => {
    const switchedOff = { ...operations, enabled: false, nextRunAt: null, revision: 2 };
    const { host, calls } = service((call) =>
      call.method === "PUT" ? { status: 200, body: switchedOff } : undefined,
    );
    const wrapper = await mountPage(host);

    card(wrapper, operations).findComponent({ name: "ElSwitch" }).vm.$emit("update:modelValue", false);
    await flushPromises();

    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.path).toBe(`${BASE}/${operations.id}/enabled`);
    expect(put.body).toEqual({ enabled: false, revision: operations.revision });
    expect(titles(wrapper)).toEqual(listed.map((item) => item.title));
    expect(text(card(wrapper, operations))).toContain("Switched off");
  });

  it("narrows by application through the address, and searches titles without reordering", async () => {
    const { host, calls } = service();
    const wrapper = await mountPage(host);

    await wrapper.find('.chip[data-app="agents"]').trigger("click");
    expect(wrapper.emitted("selectApp")).toEqual([["agents"]]);
    await wrapper.setProps({ app: "agents" });
    await flushPromises();
    expect(calls.at(-1)!.path).toBe(`${BASE}?appId=agents`);
    expect(wrapper.find('.chip[data-app="agents"]').attributes("aria-pressed")).toBe("true");

    await wrapper.setProps({ app: null });
    await flushPromises();
    await wrapper.findComponent({ name: "ElInput" }).vm.$emit("update:modelValue", "每");
    expect(titles(wrapper)).toEqual(listed.map((item) => item.title).filter((title) => title.includes("每")));
    await wrapper.findComponent({ name: "ElInput" }).vm.$emit("update:modelValue", "回归");
    expect(titles(wrapper)).toEqual([operations.title]);
  });

  it("filters only by the applications holding tasks, and keeps the one the address narrows to", async () => {
    const counts: Record<string, number> = { ontology: 2, governance: 1 };
    const served = applications();
    const body = platformScheduleApplicationsSchema.parse({
      applications: served.applications.map((application) => ({ ...application, taskCount: counts[application.id] ?? 0 })),
      totalCount: 3,
    });
    const { host } = service((call) => (call.path === `${BASE}/applications` ? { status: 200, body } : undefined));
    const wrapper = await mountPage(host);

    expect(chipTexts(wrapper)).toEqual(expect.arrayContaining(["All 3", "Ontology Manager 2", "Knowledge governance 1"]));
    expect(chipApps(wrapper)).not.toContain("agents");
    expect(chipApps(wrapper)).not.toContain("operations");

    await wrapper.setProps({ app: "operations" });
    await flushPromises();
    expect(chipTexts(wrapper)).toContain("Operations diagnosis 0");
    expect(wrapper.find('.chip[data-app="operations"]').attributes("aria-pressed")).toBe("true");

    await wrapper.setProps({ app: null });
    await flushPromises();
    expect(chipApps(wrapper)).not.toContain("operations");
  });

  it("puts the applications beyond five behind “more”, which names the one chosen there", async () => {
    const rail = Array.from({ length: 7 }, (_, index) => ({
      id: `app${index + 1}`,
      label: `App ${index + 1}`,
      icon: HOST_APPS[0]!.icon,
    }));
    const body = platformScheduleApplicationsSchema.parse({
      applications: rail.map(({ id }) => ({ id, description: null, available: true, unavailableReason: null, taskCount: 1 })),
      totalCount: 7,
    });
    const { host } = service((call) => (call.path === `${BASE}/applications` ? { status: 200, body } : undefined));
    const wrapper = await mountPage({ ...host, applications: () => rail });

    expect(wrapper.find(".chip.more").exists()).toBe(true);
    expect(chipTexts(wrapper)).toContain("All 7");
    const row = chipApps(wrapper).filter((id): id is string => Boolean(id));
    await wrapper.find(".chip.more").trigger("click");
    await flushPromises();
    const more = wrapper.findAll(".schedule-filter-item").map((item) => item.attributes("data-app"));
    // Each application is offered once: the ones on the row and the rest behind "more".
    expect([...row, ...more].sort()).toEqual(["app1", "app2", "app3", "app4", "app5", "app6", "app7"]);

    await wrapper.find('.schedule-filter-item[data-app="app7"]').trigger("click");
    expect(wrapper.emitted("selectApp")).toEqual([["app7"]]);
    await wrapper.setProps({ app: "app7" });
    await flushPromises();
    // The chosen one reads in the row: the "more" button carries its name instead of hiding it.
    expect(wrapper.find(".chip.more").text()).toContain("App 7");
  });

  it("opens a result through the host, and has none to open before a run left one", async () => {
    const { host, opened } = service();
    const wrapper = await mountPage(host);

    await card(wrapper, ontology).find("button.result").trigger("click");
    expect(opened).toEqual([completedOntologyRun.resultLink]);
    expect(card(wrapper, operations).find("button.result").attributes("disabled")).toBeDefined();
  });

  it("resends a manual run with its key after no answer came, and takes a new key once one did", async () => {
    let posts = 0;
    const { host, calls } = service((call) => {
      if (call.method !== "POST" || !call.path.endsWith("/runs")) return undefined;
      posts += 1;
      return posts === 1 ? dropped() : { status: 202, body: run("operations-batch-skipped") };
    });
    const wrapper = await mountPage(host);
    const runNow = async () => {
      card(wrapper, operations).findComponent({ name: "ElDropdown" }).vm.$emit("command", "runNow");
      await flushPromises();
    };

    await runNow();
    await runNow();
    await runNow();

    const keys = calls
      .filter((call) => call.method === "POST" && call.path === `${BASE}/${operations.id}/runs`)
      .map((call) => call.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("reads the task and the run a link names before it opens their record", async () => {
    const held = deferred<Answer>();
    const { host, calls } = service((call) => {
      if (call.path === `${BASE}/${ontology.id}`) return { status: 200, body: ontology };
      if (call.path === `${BASE}/${ontology.id}/runs/${completedOntologyRun.id}`) return held.promise;
      return undefined;
    });
    const wrapper = await mountPage(host, { taskId: ontology.id, runId: completedOntologyRun.id });

    expect(calls.map((call) => call.path)).toContain(`${BASE}/${ontology.id}`);
    expect(wrapper.findComponent(ScheduleRunsDrawer).exists()).toBe(false);

    held.resolve({ status: 200, body: completedOntologyRun });
    await flushPromises();

    const drawer = wrapper.findComponent(ScheduleRunsDrawer);
    expect(drawer.props("focusRun")).toEqual(completedOntologyRun);
    // The linked run opens expanded: what the action really ran with is on screen.
    expect(text(drawer)).toContain("2026-11-06T15:00:03Z");
  });

  it("stays on the cards and gives the link back when the run it names cannot be read", async () => {
    const missing = refusal("foreign-task");
    const { host } = service((call) =>
      call.path.startsWith(`${BASE}/${ontology.id}`) ? { status: missing.status, body: missing.body } : undefined,
    );
    const wrapper = await mountPage(host, { taskId: ontology.id, runId: completedOntologyRun.id });

    expect(wrapper.findComponent(ScheduleRunsDrawer).exists()).toBe(false);
    expect(wrapper.emitted("recordsClosed")).toHaveLength(1);
    expect(titles(wrapper)).toEqual(listed.map((item) => item.title));
  });
});
