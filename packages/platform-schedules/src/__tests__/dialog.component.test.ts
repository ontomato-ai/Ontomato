import { afterEach, describe, expect, it, vi } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { platformScheduleFormSchema } from "@ontomato/contracts/platform-schedules";
import { FormFields } from "@ontomato/foundation-ui/form";
import { createSchedulesApi } from "../api";
import { joinApplications } from "../apps";
import { createAttempts } from "../attempts";
import ScheduleTaskDialog from "../components/ScheduleTaskDialog.vue";
import {
  BASE,
  HOST_APPS,
  applications,
  deferred,
  dropped,
  fakeHost,
  flushPromises,
  form,
  formRequest,
  mount,
  pageGlobal,
  refusal,
  task,
  text,
  type Answer,
  type Call,
} from "./fixtures";

const apps = joinApplications(HOST_APPS, applications()).apps;

let mounted: VueWrapper[] = [];
afterEach(async () => {
  // Element Plus measures an auto-growing text box a tick after it changes; that tick runs before the form goes.
  await flushPromises();
  mounted.forEach((wrapper) => wrapper.unmount());
  mounted = [];
});

async function mountDialog(route: (call: Call) => Answer | Promise<Answer>, props: Record<string, unknown> = {}) {
  const service = fakeHost(route);
  const wrapper = mount(ScheduleTaskDialog, {
    props: {
      api: createSchedulesApi(service.host),
      task: null,
      apps,
      appInfo: (id: string) => ({ label: id, icon: HOST_APPS[0]!.icon }),
      serviceZone: "Asia/Shanghai",
      defaultAppId: null,
      attempts: createAttempts(),
      ...props,
    },
    global: pageGlobal(),
    // In the document, so that its styles apply and a test can read the layout they give it.
    attachTo: document.body,
  });
  mounted.push(wrapper);
  // The dialog draws its content once it has opened.
  await flushPromises();
  return { wrapper, ...service };
}

const item = (wrapper: VueWrapper, key: string) =>
  wrapper.findAllComponents({ name: "ElFormItem" }).find((found) => found.attributes("data-field") === key)!;
const chooseApp = (wrapper: VueWrapper, id: string) =>
  item(wrapper, "appId").findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", id);
const choose = (wrapper: VueWrapper, key: string, value: string) =>
  item(wrapper, key).findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", value);
const type = (wrapper: VueWrapper, key: string, value: string) =>
  item(wrapper, key).findComponent({ name: "ElInput" }).vm.$emit("update:modelValue", value);
/** The application's fields on screen, by label, in its order. */
const fields = (wrapper: VueWrapper) =>
  wrapper.findComponent(FormFields).findAll(".el-form-item__label").map((label) => label.text());
const submitButton = (wrapper: VueWrapper) => wrapper.find('[data-action="submit"]');
async function submit(wrapper: VueWrapper) {
  await submitButton(wrapper).trigger("click");
  await flushPromises();
}
const creates = (calls: Call[]) => calls.filter((call) => call.method === "POST" && call.path === BASE);

describe("writing a scheduled task", () => {
  it("reads the chosen application's form, and reads it again whole when a choice it depends on changes", async () => {
    const { wrapper, calls } = await mountDialog((call) => {
      if (call.path === `${BASE}/applications/operations/form`) {
        const changed = (call.body as { changedField: string | null }).changedField;
        return { status: 200, body: changed === "operation" ? form("operations-switch-to-inspection") : form("operations-empty") };
      }
      if (call.method === "POST" && call.path === BASE) return { status: 201, body: task("operations-autotest") };
      throw new Error(`Unexpected ${call.method} ${call.path}`);
    });

    await chooseApp(wrapper, "operations");
    await flushPromises();
    expect(calls[0]!.body).toEqual(formRequest("operations-empty"));
    expect(fields(wrapper)).toEqual(["做什么", "用例集"]);
    expect(text(wrapper)).toContain("What Operations diagnosis gets");

    // A choice the form does not depend on stays in the draft; one it depends on sends the whole draft back.
    await choose(wrapper, "caseSetId", "set-regression");
    expect(calls).toHaveLength(1);
    await choose(wrapper, "operation", "inspection");
    await flushPromises();
    expect(calls[1]!.body).toEqual(formRequest("operations-switch-to-inspection"));
    expect(fields(wrapper)).toEqual(["做什么", "指令"]);

    // The removed field went with its value: the save carries exactly the new form's values and revision.
    await type(wrapper, "title", "Morning inspection");
    await type(wrapper, "instruction", "Check yesterday's failed questions");
    await submit(wrapper);
    expect(creates(calls)[0]!.body).toMatchObject({
      title: "Morning inspection",
      appId: "operations",
      content: { operation: "inspection", instruction: "Check yesterday's failed questions" },
      formRevision: "inspection-v1",
      timeZone: "Asia/Shanghai",
    });
  });

  it("takes only the newest form answer, and saves nothing while a form is being read", async () => {
    const agents = deferred<Answer>();
    const governance = deferred<Answer>();
    const { wrapper } = await mountDialog((call) =>
      call.path.endsWith("/applications/agents/form") ? agents.promise : governance.promise,
    );

    await chooseApp(wrapper, "agents");
    await chooseApp(wrapper, "governance");
    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

    governance.resolve({ status: 200, body: form("governance-empty") });
    await flushPromises();
    // The answer for the application the reader already left arrives late and is dropped.
    agents.resolve({ status: 200, body: form("agents-empty") });
    await flushPromises();

    expect(fields(wrapper)).toEqual(["指令"]);
    expect(text(wrapper)).toContain("What Knowledge governance gets");
    expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("puts the form the service changed in place of the draft, says so, and leaves the next save to the reader", async () => {
    const changed = refusal("form-changed");
    const opened = platformScheduleFormSchema.parse({ ...changed.body.error.form!, formRevision: "rebuild-cache-sha256-v1" });
    let posts = 0;
    const { wrapper, calls } = await mountDialog((call) => {
      if (call.path === `${BASE}/applications/ontology/form`) return { status: 200, body: opened };
      posts += 1;
      return posts === 1
        ? { status: changed.status, body: changed.body }
        : {
            status: 201,
            body: task("ontology-with-line-arrays", {
              content: { execution: "function:rebuild-cache" },
              formRevision: "rebuild-cache-sha256-v2",
              summary: [{ key: "execution", label: "执行", value: "重建缓存" }],
            }),
          };
    });

    await chooseApp(wrapper, "ontology");
    await flushPromises();
    await type(wrapper, "title", "Nightly cache");
    await submit(wrapper);

    expect(creates(calls)).toHaveLength(1);
    expect(text(wrapper)).toContain("The application's form changed since you opened it");
    expect(wrapper.emitted("saved")).toBeUndefined();

    await submit(wrapper);
    const [first, second] = creates(calls);
    expect(second!.body).toMatchObject({ formRevision: "rebuild-cache-sha256-v2", content: { execution: "function:rebuild-cache" } });
    expect(second!.headers["Idempotency-Key"]).not.toBe(first!.headers["Idempotency-Key"]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("saves again with the same key after no answer came, and with a new key once the draft changed", async () => {
    let posts = 0;
    const { wrapper, calls } = await mountDialog((call) => {
      if (call.path === `${BASE}/applications/governance/form`) return { status: 200, body: form("governance-empty") };
      posts += 1;
      return posts < 3 ? dropped() : { status: 201, body: task("governance-instruction") };
    });

    await chooseApp(wrapper, "governance");
    await flushPromises();
    await type(wrapper, "title", "Weekly knowledge check");
    await type(wrapper, "instruction", "Find conflicting definitions");
    await submit(wrapper);
    expect(text(wrapper)).toContain("Saving again resends the same request, so the task is not created twice.");
    await submit(wrapper);
    await type(wrapper, "instruction", "Find conflicting definitions and their sources");
    await submit(wrapper);

    const keys = creates(calls).map((call) => call.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(wrapper.emitted("saved")).toEqual([[task("governance-instruction"), true]]);
  });

  it("keeps the title and the buttons in view while a long form scrolls between them", async () => {
    const { wrapper } = await mountDialog((call) => {
      if (call.path === `${BASE}/applications/ontology/form`) {
        return { status: 200, body: form("ontology-selection-clears-old-parameters") };
      }
      throw new Error(`Unexpected ${call.method} ${call.path}`);
    });
    await chooseApp(wrapper, "ontology");
    await flushPromises();

    const dialog = wrapper.find(".el-dialog.schedule-dialog");
    const [header, body, footer] = (["header", "body", "footer"] as const).map((part) => dialog.find(`.el-dialog__${part}`));
    // The title and the buttons sit outside the part that scrolls; every field the action declares is inside it.
    expect(header.text()).toContain("New scheduled task");
    expect(footer.find('[data-action="submit"]').exists()).toBe(true);
    expect(body.find('[data-action="submit"]').exists()).toBe(false);
    expect(body.findAll('[data-field^="parameter:"]')).toHaveLength(4);

    // The overlay bounds the dialog: a column whose header and footer keep their height and whose body scrolls.
    const style = (element: Element) => getComputedStyle(element);
    expect([style(dialog.element).display, style(dialog.element).flexDirection]).toEqual(["flex", "column"]);
    expect(style(dialog.element).maxHeight).toMatch(/^calc\(100% - /);
    expect(style(body.element).overflowY).toBe("auto");
    expect(style(body.element).minHeight).toMatch(/^0(px)?$/);
    for (const fixed of [header, footer]) expect(style(fixed.element).flexShrink).toBe("0");
  });

  it("puts the service's field errors on the fields they name", async () => {
    const invalid = refusal("numeric-array-validation");
    const { wrapper } = await mountDialog((call) => {
      if (call.path === `${BASE}/applications/ontology/form`) {
        return { status: 200, body: form("ontology-selection-clears-old-parameters") };
      }
      return { status: invalid.status, body: invalid.body };
    });

    await chooseApp(wrapper, "ontology");
    await flushPromises();
    await type(wrapper, "title", "Nightly status check");
    await type(wrapper, "parameter:departments", "Sales");
    await type(wrapper, "parameter:thresholds", "10\nten");
    await type(wrapper, "parameter:checkpoints", "2026-11-06");
    await submit(wrapper);

    await vi.waitFor(() => expect(item(wrapper, "parameter:thresholds").find(".el-form-item__error").exists()).toBe(true));
    expect(item(wrapper, "parameter:thresholds").find(".el-form-item__error").text()).toBe("第2行不是有效数字");
  });

  it("edits a task as the service holds it, showing an option that is no longer available with its reason", async () => {
    const own = task("agents-instruction", {
      content: { agentId: "20000000-0000-4000-8000-000000000002", instruction: "保留原指令" },
    });
    const { wrapper, calls } = await mountDialog(
      (call) => {
        if (call.method === "GET" && call.path === `${BASE}/${own.id}`) return { status: 200, body: own };
        if (call.path === `${BASE}/applications/agents/form`) return { status: 200, body: form("edit-unavailable-agent") };
        throw new Error(`Unexpected ${call.method} ${call.path}`);
      },
      { task: own },
    );

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET ${BASE}/${own.id}`,
      `POST ${BASE}/applications/agents/form`,
    ]);
    expect(calls[1]!.body).toEqual(formRequest("edit-unavailable-agent"));
    await vi.waitFor(() => expect(item(wrapper, "agentId").find(".el-form-item__error").exists()).toBe(true));
    expect(item(wrapper, "agentId").find(".el-form-item__error").text()).toBe("智能体已停用");
    const options = item(wrapper, "agentId").findAll(".el-select-dropdown__item");
    const unavailable = options.find((option) => option.text().includes("原智能体"))!;
    expect(unavailable.classes()).toContain("is-disabled");
    expect(unavailable.findAll(".option > span").map((line) => line.text())).toEqual(["原智能体", "智能体已停用"]);

    // The browser does not offer the save the service would refuse: nothing is sent.
    await submit(wrapper);
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });
});
