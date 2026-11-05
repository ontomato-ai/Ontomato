import { afterEach, describe, expect, it, vi } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import PlatformScheduleForm from "../components/PlatformScheduleForm.vue";
import { flushPromises, mount, pageGlobal, task, text, translate, testI18n } from "./fixtures";

const i18n = testI18n();
const t = translate(i18n);
const AGENT = { id: "22222222-2222-4222-8222-222222222222", name: "Analyst", description: "", icon: null, enabled: true };
const FUNCTION = { id: "f-1", name: "Refresh revenue", description: "Rebuilds the revenue table" };

let mounted: VueWrapper | null = null;

/**
 * Element Plus's auto-growing textarea measures itself a tick after a value changes; letting that tick run before the
 * form unmounts keeps the measurement off a null ref.
 */
afterEach(async () => {
  await flushPromises();
  mounted?.unmount();
  mounted = null;
});

function mountForm(props: Record<string, unknown> = {}) {
  const wrapper = mount(PlatformScheduleForm, {
    props: { task: null, agents: [AGENT], functions: [FUNCTION], timeZone: "Asia/Shanghai", locale: "en", saving: false, t, ...props },
    global: pageGlobal(i18n),
  });
  mounted = wrapper as VueWrapper;
  return wrapper;
}

/** Element Plus shows a field's error message one debounce after its state changes. */
async function errorText(wrapper: ReturnType<typeof mountForm>): Promise<string> {
  await vi.waitFor(() => expect(wrapper.findAll(".el-form-item__error").length).toBeGreaterThan(0));
  return wrapper.findAll(".el-form-item__error").map((error) => error.text()).join(" ");
}

/** The input the form handed up, from the one submit it emitted. */
function submitted(wrapper: ReturnType<typeof mountForm>): Record<string, unknown> {
  return (wrapper.emitted("submit") as unknown[][])[0]![0] as Record<string, unknown>;
}

/** Types into the Nth text field of the form (name, then description, then the prompt). */
async function type(wrapper: ReturnType<typeof mountForm>, index: number, value: string) {
  await wrapper.findAllComponents({ name: "ElInput" })[index]!.vm.$emit("update:modelValue", value);
}

describe("platform schedule form", () => {
  it("registers an agent task with a prompt, a cadence and the service's zone", async () => {
    const wrapper = mountForm();
    await type(wrapper, 0, "Nightly summary");
    await type(wrapper, 2, "Summarise yesterday's orders");

    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([
      [
        {
          name: "Nightly summary",
          description: null,
          target: { kind: "agent", agentId: AGENT.id, prompt: "Summarise yesterday's orders" },
          frequency: { kind: "daily", time: "09:00" },
          timeZone: "Asia/Shanghai",
          notifyEmail: null,
        },
      ],
    ]);
  });

  it("registers a function task without an agent or a prompt", async () => {
    const wrapper = mountForm();
    await type(wrapper, 0, "Refresh revenue nightly");
    // The target is a segmented control: switching it to the function side drops the agent fields. Element Plus's
    // measuring tick for the prompt runs before that swap, so the swap waits for it.
    await flushPromises();
    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "function");
    // The function picker comes first; the cadence picker follows it.
    const frequencyKind = wrapper.findAllComponents({ name: "ElSelect" })[1]!;
    await frequencyKind.vm.$emit("update:modelValue", "cron");
    await wrapper.findAllComponents({ name: "ElInput" }).at(-1)!.vm.$emit("update:modelValue", "0 30 2 * * *");
    // Element Plus measures a text field one tick after its value changes; that tick runs before the form is torn down.
    await flushPromises();

    await wrapper.find("form").trigger("submit");

    const input = submitted(wrapper);
    expect(input.target).toEqual({ kind: "function", functionId: FUNCTION.id });
    expect(input.frequency).toEqual({ kind: "cron", expression: "0 30 2 * * *" });
  });

  it("marks the fields the contract refuses instead of submitting them", async () => {
    const wrapper = mountForm();

    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toBeUndefined();
    const errors = await errorText(wrapper);
    expect(errors).toContain("Enter a name.");
    expect(errors).toContain("Enter what the agent should do.");
  });

  it("opens an existing task on its own agent, including a disabled one, and keeps its zone", async () => {
    const disabledAgent = { id: "77777777-7777-4777-8777-777777777777", name: "Retired", description: "", icon: null, enabled: false };
    const wrapper = mountForm({
      task: task({
        target: { kind: "agent", agentId: disabledAgent.id, prompt: "Old job" },
        timeZone: "Europe/Berlin",
      }),
      agents: [AGENT, disabledAgent],
    });

    expect(wrapper.findComponent({ name: "ElForm" }).exists()).toBe(true);
    await wrapper.find("form").trigger("submit");

    const input = submitted(wrapper);
    expect(input.target).toEqual({ kind: "agent", agentId: disabledAgent.id, prompt: "Old job" });
    expect(input.timeZone).toBe("Europe/Berlin");
  });

  it("preselects the scoped agent for a new task", async () => {
    const wrapper = mountForm({ defaultAgentId: AGENT.id, functions: [] });
    await type(wrapper, 0, "Scoped task");
    await type(wrapper, 2, "Do the thing");

    await wrapper.find("form").trigger("submit");

    const input = submitted(wrapper);
    expect(input.target).toEqual({ kind: "agent", agentId: AGENT.id, prompt: "Do the thing" });
  });

  it("says there is no function to choose when the domain has none", async () => {
    const wrapper = mountForm({ functions: [] });
    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "function");

    expect(text(wrapper)).toContain("This domain has no zero-parameter write function yet.");
  });

  it("says the account may not schedule functions, and still submits an agent task", async () => {
    const wrapper = mountForm({ functions: [], functionsRefused: true });
    await type(wrapper, 0, "Agent only");
    await type(wrapper, 2, "Do the thing");
    // Switching the target away from the agent drops the prompt and its pending measuring tick.
    await flushPromises();

    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "function");
    expect(text(wrapper)).toContain("You cannot schedule functions");
    expect(text(wrapper)).toContain("Scheduling functions needs the function tasks permission.");

    // The refusal only removes one kind of task; the agent side still saves.
    await wrapper.findComponent({ name: "ElSegmented" }).vm.$emit("update:modelValue", "agent");
    await wrapper.find("form").trigger("submit");

    const input = submitted(wrapper);
    expect(input.target).toEqual({ kind: "agent", agentId: AGENT.id, prompt: "Do the thing" });
  });

  it("sends the mail address only when asked to mail the result", async () => {
    const wrapper = mountForm();
    await type(wrapper, 0, "Mailed task");
    await type(wrapper, 2, "Do the thing");
    await wrapper.findAllComponents({ name: "ElSwitch" })[0]!.vm.$emit("update:modelValue", true);
    await wrapper.findAllComponents({ name: "ElInput" })[0]!.vm.$emit("update:modelValue", "Mailed task");
    const email = wrapper.findAllComponents({ name: "ElInput" }).at(-1)!;
    await email.vm.$emit("update:modelValue", "not-an-address");

    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(await errorText(wrapper)).toContain("Enter a valid email address.");

    await email.vm.$emit("update:modelValue", "ops@example.com");
    await wrapper.find("form").trigger("submit");

    const input = submitted(wrapper);
    expect(input.notifyEmail).toBe("ops@example.com");
  });
});
