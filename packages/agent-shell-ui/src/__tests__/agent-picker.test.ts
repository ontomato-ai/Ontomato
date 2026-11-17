import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import AgentPicker from "../components/AgentPicker.vue";

it("keeps the agent picker mounted while the initial list arrives", async () => {
  const agents = ref<AgentHostAgent[]>([]);
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(AgentPicker, {
    variant: "pill", agents: agents.value, agentId: "agent", label: "Select agent",
  }) });
  app.mount(root);
  try {
    const trigger = root.querySelector<HTMLButtonElement>(".switch-trigger")!;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toContain("Select agent");
    agents.value = [{ id: "agent", name: "Sales analyst", description: "", icon: null, enabled: true }];
    await nextTick();
    expect(root.querySelector(".switch-trigger")).toBe(trigger);
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent).toContain("Sales analyst");
  } finally {
    app.unmount();
    root.remove();
  }
});
