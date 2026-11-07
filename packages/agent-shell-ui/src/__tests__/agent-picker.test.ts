import { createApp, h, nextTick, ref } from "vue";
import { expect, it } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { ShellLabels } from "../types";
import ShellNavBody from "../components/ShellNavBody.vue";

it("keeps the agent picker mounted while the initial list arrives", async () => {
  const agents = ref<AgentHostAgent[]>([]);
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ShellNavBody, {
    title: "Agent platform", workbench: { id: "business", label: "Agents", features: [] },
    agentPicker: true, agents: agents.value, agentId: "agent", sessions: [],
    sessionsState: "loading", hasMore: false, sessionId: null, featureId: null,
    labels: { agent: "Select agent" } as ShellLabels,
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
    expect(root.querySelector(".column-head")).toBeNull();
  } finally {
    app.unmount();
    root.remove();
  }
});
