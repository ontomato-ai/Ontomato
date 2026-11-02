import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import type { ScheduledTask } from "@ontomato/contracts/scheduled-tasks";
import ScheduledTaskForm from "../components/ScheduledTaskForm.vue";
import en from "../../../locales/en";

/** The form submits only inputs the server contract accepts, and keeps what an edited task already has. */
const agents = [
  { id: "00000000-0000-4000-8000-00000000000a", name: "Analyst", description: "", icon: null, enabled: true },
  { id: "00000000-0000-4000-8000-00000000000b", name: "Retired", description: "", icon: null, enabled: false },
];

function form(task: ScheduledTask | null = null) {
  return mount(ScheduledTaskForm, {
    props: { task, agents, timeZone: "Asia/Shanghai", saving: false },
    // The autosized textarea measures itself after rendering, which needs a mounted element.
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } }), ElementPlus] },
  });
}

describe("scheduled task form", () => {
  it("does not submit without a prompt or with a mail switch but no valid address", async () => {
    const wrapper = form();
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.find("textarea").setValue("Summarize yesterday's orders");
    await wrapper.find(".el-switch").trigger("click");
    await wrapper.find("input[type='email']").setValue("not-an-address");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.find("input[type='email']").setValue("owner@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.emitted("submit")?.[0]?.[0]).toEqual({
      agentId: agents[0]!.id,
      prompt: "Summarize yesterday's orders",
      frequency: { kind: "daily", time: "09:00" },
      notifyEmail: "owner@example.com",
    });
    await flushPromises();
    wrapper.unmount();
  });

  it("keeps an edited task's frequency, agent and mail", async () => {
    const task: ScheduledTask = {
      id: "00000000-0000-4000-8000-000000000001",
      agentId: agents[0]!.id,
      prompt: "Month-end report",
      frequency: { kind: "monthly", day: 31, time: "18:30" },
      notifyEmail: null,
      enabled: true,
      pausedReason: null,
      nextRunAt: null,
      lastRun: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const wrapper = form(task);
    await wrapper.find("form").trigger("submit");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toEqual({
      agentId: task.agentId,
      prompt: task.prompt,
      frequency: task.frequency,
      notifyEmail: null,
    });
    await flushPromises();
    wrapper.unmount();
  });
});
