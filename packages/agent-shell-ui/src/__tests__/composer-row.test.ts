import { createApp, h, nextTick, ref } from "vue";
import { afterEach, expect, it } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import ShellComposer from "../components/ShellComposer.vue";
import AgentPicker from "../components/AgentPicker.vue";

/*
 * The platform has one composer, and a page without the agent platform's column shows it as one row (DESIGN.md
 * "Applications and shells"): left to right, the agent the message goes to, the input, what the message carries and send.
 * No host sets a height of its own; a conversation's composer is the same control opened into two rows.
 */
const agents: AgentHostAgent[] = [
  { id: "assistant", name: "Assistant", description: "", icon: null, enabled: true },
  { id: "analyst", name: "Analyst", description: "", icon: null, enabled: true },
];
const roots: HTMLElement[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => root.remove());
});

it("keeps the agent, the input, what a message carries and send on one row", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const agentId = ref<string | null>("assistant");
  const sent: string[] = [];
  const app = createApp({
    render: () =>
      h(
        ShellComposer,
        { busy: false, labels: { placeholder: "Ask", send: "Send", stop: "Stop" }, onSend: (text: string) => sent.push(text) },
        {
          agent: () => h(AgentPicker, {
            variant: "pill", agents, agentId: agentId.value, label: "Agent", onSelect: (id: string) => (agentId.value = id),
          }),
          context: () => h("span", { class: "carried" }, "Current page"),
        },
      ),
  });
  app.mount(root);
  try {
    // The textarea has no class of its own: the row is the agent, the input, what it carries, and the buttons.
    const row = [...root.querySelector(".composer")!.children].map((child) => child.className || child.tagName.toLowerCase());
    expect(row).toEqual(["composer-agent", "textarea", "composer-context", "composer-actions"]);
    // The agent is the row's own control, not a second one under the input.
    expect(root.querySelector(".composer .switch-trigger")).not.toBeNull();
    expect(root.querySelector(".composer .carried")).not.toBeNull();

    const input = root.querySelector("textarea")!;
    input.value = "Which region grew fastest?";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    (root.querySelector(".composer-button") as HTMLButtonElement).click();
    await flushPromises();
    expect(sent).toEqual(["Which region grew fastest?"]);
  } finally {
    app.unmount();
  }
});

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve));
}
