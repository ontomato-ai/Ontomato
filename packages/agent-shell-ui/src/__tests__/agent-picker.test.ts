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

it("hangs the list from the trigger's own edge, up or down, inside the viewport", async () => {
  // At the foot of the window the list opens upwards and its bottom stays on the trigger's top edge: it does not float
  // away to wherever the remaining room happens to end.
  const footTop = window.innerHeight - 16 - 32;
  const up = await openAt(window.innerHeight - 16);
  try {
    expect(up.style.top).toBe("");
    // Its bottom edge is just above the trigger: the distance from the viewport's bottom is the trigger's top plus the gap.
    expect(Number.parseFloat(up.style.bottom)).toBe(window.innerHeight - footTop + 4);
    // And it has as much height as the room above allows, which is more than its first line.
    expect(Number.parseFloat(up.style.maxHeight)).toBe(footTop - 4 - 16);
    expect(Number.parseFloat(up.style.maxHeight)).toBeGreaterThan(100);
  } finally {
    up.app.unmount();
    up.root.remove();
  }
});

it("opens the list down from the trigger when the viewport has room below it", async () => {
  const middle = Math.round(window.innerHeight / 2);
  const down = await openAt(middle);
  try {
    expect(down.style.bottom).toBe("");
    expect(Number.parseFloat(down.style.top)).toBe(middle + 4);
    expect(Number.parseFloat(down.style.maxHeight)).toBe(window.innerHeight - middle - 4 - 16);
    expect(Number.parseFloat(down.style.top) + Number.parseFloat(down.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 16);
  } finally {
    down.app.unmount();
    down.root.remove();
  }
});
