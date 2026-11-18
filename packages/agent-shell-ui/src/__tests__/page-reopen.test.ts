import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { testDisplay } from "./display";
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
  const display = testDisplay(workbench, {
    initial: { page: { featureId: "panel", address: "/panel", instance: "panel" }, view: "side" },
  });
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
          display,
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
  await settle();
  expect(display.page.value).toBeNull();

  root.querySelector<HTMLButtonElement>(".reopen-page")!.click();
  await settle();
  expect([display.page.value?.featureId, display.view.value]).toEqual(["panel", "side"]);
  expect(root.querySelector(".reopen-page")).toBeNull();
});
