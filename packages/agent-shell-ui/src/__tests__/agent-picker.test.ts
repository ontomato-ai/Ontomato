import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
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

/**
 * The composer sits at the foot of the page, and of the window: a list that always opened downwards would start at the
 * bottom edge and show a single item. It opens downwards while there is room, and upwards when there is not.
 */
async function openAt(bottom: number) {
  const agents: AgentHostAgent[] = ["one", "two", "three"].map((id) => ({ id, name: id, description: "", icon: null, enabled: true }));
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(AgentPicker, { variant: "pill", agents, agentId: "one", label: "Select agent" }) });
  app.mount(root);
  const trigger = root.querySelector<HTMLElement>(".switch-trigger")!;
  // The list is placed against the composer's own control, which is what the picker measures.
  vi.spyOn(root.querySelector<HTMLElement>(".agent-switch")!, "getBoundingClientRect").mockReturnValue({
    top: bottom - 32, bottom, left: 40, right: 200, width: 160, height: 32, x: 40, y: bottom - 32, toJSON: () => ({}),
  } as DOMRect);
  trigger.click();
  await nextTick();
  const menu = root.querySelector<HTMLElement>(".agent-menu")!;
  return { app, root, menu, style: menu.style };
}

it.each([
  ["at the foot of the window", true],
  ["in the middle of the window", false],
])("opens the list %s without cutting it off", async (_case, upwards) => {
  const bottom = upwards ? window.innerHeight - 16 : Math.round(window.innerHeight / 2);
  const drawn = await openAt(bottom);
  try {
    const top = Number.parseFloat(drawn.style.top);
    const height = Number.parseFloat(drawn.style.maxHeight);
    // The list is where the viewport has room for it, and stays inside the viewport.
    expect(upwards ? top + height <= bottom - 32 : top >= bottom).toBe(true);
    // A list with room shows more than its first line.
    expect(height).toBeGreaterThan(100);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight - 16);
  } finally {
    drawn.app.unmount();
    drawn.root.remove();
  }
});
