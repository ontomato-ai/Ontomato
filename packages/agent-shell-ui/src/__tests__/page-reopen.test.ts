import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import type { AgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = {
  id: "builder",
  label: "Builder",
  features: [{ id: "panel", label: "Workspace", icon: "pages", availability: "page", withConversation: true }],
};
const labels = { placeholder: "Message", send: "Send", stop: "Stop", open: "Open in panel", close: "Close" } as unknown as ShellLabels;

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

/**
 * The agent-app states (DESIGN "Agent apps"): a paired page closed beside the conversation leaves a way back in the
 * conversation's corner, for an application whose column has no entry for the page (the app builder's column lists
 * workspaces).
 */
it("reopens the closed page beside the conversation from the conversation's corner", async () => {
  const port = {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
  } as unknown as AgentHostClient;
  const featureId = ref<string | null>("panel");
  const pageView = ref<"full" | "side">("side");
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => port,
        agentId: () => null,
        setAgentId: () => {},
        sessionId: () => null,
        setSessionId: () => {},
      });
      return () =>
        h(AgentShell, {
          workbench,
          client: port,
          labels,
          nav,
          featureId: featureId.value,
          "onUpdate:featureId": (id: string | null) => (featureId.value = id),
          pageView: pageView.value,
          "onUpdate:pageView": (view: "full" | "side") => (pageView.value = view),
        });
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.mount(root);
  await nextTick();

  expect(root.querySelector(".reopen-page")).toBeNull();
  root.querySelector<HTMLButtonElement>(".page-pane button[aria-label='Close']")!.click();
  await nextTick();
  expect(featureId.value).toBeNull();

  root.querySelector<HTMLButtonElement>(".reopen-page")!.click();
  await nextTick();
  expect([featureId.value, pageView.value]).toEqual(["panel", "side"]);
  expect(root.querySelector(".reopen-page")).toBeNull();
});
