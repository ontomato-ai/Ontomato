import { createApp, h, nextTick, ref } from "vue";
import { afterEach, expect, it } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import ShellComposer from "../components/ShellComposer.vue";
import AgentPicker from "../components/AgentPicker.vue";

/*
 * Where each part of the composer stands (DESIGN.md "Applications and shells"). Under a conversation: the input, and on
 * the line under it what the message carries at the left and send at the right. Floating over a page: the agent in the
 * upper layer beside the fold, and the input and send on one line below, with what the message carries before send.
 */
const agents: AgentHostAgent[] = [
  { id: "assistant", name: "Assistant", description: "", icon: null, enabled: true },
  { id: "analyst", name: "Analyst", description: "", icon: null, enabled: true },
];
const roots: HTMLElement[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => root.remove());
  localStorage.clear();
});

function mount(floating: boolean, sent: string[]) {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const agentId = ref<string | null>("assistant");
  const app = createApp({
    render: () =>
      h(
        ShellComposer,
        {
          busy: false, floating,
          labels: { placeholder: "Ask", send: "Send", stop: "Stop", collapseComposer: "Hide", expandComposer: "Ask" },
          onSend: (text: string) => sent.push(text),
        },
        {
          ...(floating
            ? { agent: () => h(AgentPicker, { variant: "pill", agents, agentId: agentId.value, label: "Agent", onSelect: (id: string) => (agentId.value = id) }) }
            : {}),
          context: () => h("span", { class: "carried" }, "Current page"),
        },
      ),
  });
  app.mount(root);
  return { root, app };
}

const names = (element: Element) => [...element.children].map((child) => child.className || child.tagName.toLowerCase());

it("puts what the message carries and send on the line under a conversation's input", async () => {
  const sent: string[] = [];
  const { root, app } = mount(false, sent);
  try {
    expect(names(root.querySelector(".composer-body")!)).toEqual(["textarea", "composer-controls"]);
    expect(names(root.querySelector(".composer-controls")!)).toEqual(["composer-context", "composer-actions"]);

    const input = root.querySelector("textarea")!;
    input.value = "Which region grew fastest?";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    (root.querySelector(".composer-button") as HTMLButtonElement).click();
    await nextTick();
    expect(sent).toEqual(["Which region grew fastest?"]);
  } finally {
    app.unmount();
  }
});

it("floats with the agent above, beside the fold, and the input and send on one line below", async () => {
  const { root, app } = mount(true, []);
  try {
    expect(root.querySelector(".composer-bar .composer-agent .switch-trigger")).not.toBeNull();
    expect(names(root.querySelector(".composer-body")!)).toEqual(["textarea", "composer-controls"]);
    expect(names(root.querySelector(".composer-controls")!)).toEqual(["composer-context", "composer-actions"]);
    expect(root.querySelector(".composer-body .switch-trigger")).toBeNull();
  } finally {
    app.unmount();
  }
});
