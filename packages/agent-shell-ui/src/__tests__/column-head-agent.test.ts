import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { useAgentNav } from "../useAgentNav";
import type { AgentHostClient } from "../host";
import type { ShellFeatureDeclaration, ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * The column's head of an application that runs on several agents is its agent chooser, always: it says which agent
 * the conversation runs on. A page open beside the conversation narrows what the chooser lists to the page's candidates
 * — one candidate is still a chooser, showing that agent — and closing the page lists every agent again. Opening the
 * address with the page already beside the conversation and opening the page later end the same way. An application
 * that runs on one agent heads its column with its own name.
 */
const labels = { placeholder: "Message", send: "Send", stop: "Stop", agent: "Agent", newConversation: "New chat" } as unknown as ShellLabels;
const assistant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const analyst = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const governance = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const every = [
  { id: assistant, name: "Assistant", description: "", icon: null, enabled: true },
  { id: analyst, name: "Analyst", description: "", icon: null, enabled: true },
  { id: governance, name: "Knowledge governance", description: "", icon: null, enabled: true },
];
const board: ShellFeatureDeclaration = {
  id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page", listed: false, withConversation: true,
  pageSkill: { pageKey: "dashboard", access: "domain-member" },
};
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "OntoPlato", features: [board] };

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function client(): AgentHostClient {
  return {
    listAgents: vi.fn().mockResolvedValue(every),
    // The board's own candidates: the assistant alone, which is also its registered default.
    listPageAgents: vi.fn().mockResolvedValue({ agents: [every[0]], defaultAgentId: assistant }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    sessionRuns: { read: vi.fn().mockResolvedValue({ sessions: [] }), subscribe: () => () => {} },
  } as unknown as AgentHostClient;
}

/** The agent platform's shell, opened at an address that may already carry a page beside the conversation. */
function render(options: { page: string | null; agentPicker?: boolean; title?: string }) {
  const featureId = ref<string | null>(options.page);
  const agentId = ref<string | null>(analyst);
  const host = client();
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => host,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => null,
        setSessionId: () => {},
      });
      // The application loads its agents once it is mounted, as the agent platform does.
      void nav.loadAgents();
      return () =>
        h(AgentShell, {
          workbench: { ...workbench, label: options.title ?? workbench.label }, client: host, labels, nav,
          agentPicker: options.agentPicker ?? true, title: options.title ?? workbench.label,
          agentId: agentId.value, "onUpdate:agentId": (id: string | null) => (agentId.value = id),
          featureId: featureId.value, "onUpdate:featureId": (id: string | null) => (featureId.value = id),
          pageView: "side",
        });
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  return { root, featureId, agentId };
}

/** What the column's head shows, and the agents its chooser lists when opened. */
async function head(root: HTMLElement) {
  const trigger = root.querySelector<HTMLButtonElement>(".shell-nav-body .switch-trigger");
  if (!trigger) return { chooser: false, title: root.querySelector(".shell-nav-body .column-head")?.textContent ?? "", shown: "", listed: [] };
  trigger.click();
  await settle();
  const listed = [...document.querySelectorAll(".agent-menu .option-name")].map((option) => option.textContent);
  trigger.click();
  await settle();
  return { chooser: true, title: "", shown: trigger.querySelector(".switch-name")?.textContent ?? "", listed };
}

it("opened with the page beside the conversation, lists the page's candidates and shows the agent in use", async () => {
  const { root, agentId } = render({ page: "dashboards" });
  await settle();

  const shown = await head(root);
  expect(shown.chooser).toBe(true);
  expect(shown.listed).toEqual(["Assistant"]);
  // The page's registered default takes over from an agent the page does not offer, and the head says so.
  expect(agentId.value).toBe(assistant);
  expect(shown.shown).toBe("Assistant");
});

it("opening the page later ends the same way, and closing it lists every agent again", async () => {
  const { root, featureId } = render({ page: null });
  await settle();
  expect((await head(root)).listed).toEqual(["Assistant", "Analyst", "Knowledge governance"]);

  featureId.value = "dashboards";
  await settle();
  const beside = await head(root);
  expect(beside.chooser).toBe(true);
  expect(beside.listed).toEqual(["Assistant"]);
  expect(beside.shown).toBe("Assistant");

  featureId.value = null;
  await settle();
  const closed = await head(root);
  expect(closed.chooser).toBe(true);
  expect(closed.listed).toEqual(["Assistant", "Analyst", "Knowledge governance"]);
});

it("heads an application that runs on one agent with its own name", async () => {
  const { root } = render({ page: null, agentPicker: false, title: "Operations diagnosis" });
  await settle();

  const shown = await head(root);
  expect(shown.chooser).toBe(false);
  expect(shown.title).toBe("Operations diagnosis");
});
