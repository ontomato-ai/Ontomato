import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { AgentHostClient } from "../host";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = {
  id: "business",
  label: "Agent Platform",
  features: [{ id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page" }],
};

/** A host that serves nothing: the shell only has to render, not to load. */
function client(): AgentHostClient {
  const empty = {
    listAgents: async () => [],
    listSessions: async () => ({ sessions: [], nextCursor: null }),
    readHistory: async () => ({ messages: [], runs: [], cursor: null }),
  };
  return empty as unknown as AgentHostClient;
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function render(embedded: boolean) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({
    render: () =>
      h(AgentShell, {
        workbench,
        client: client(),
        labels: {} as ShellLabels,
        embedded,
      }),
  });
  app.provide(shellContextKey, { labels: ref({} as ShellLabels) } as unknown as ShellContext);
  app.mount(root);
  await nextTick();
  await nextTick();
  return root;
}

describe("embedded mode", () => {
  it("draws no sidebar of its own and no panel chrome", async () => {
    const root = await render(true);
    const shell = root.querySelector(".agent-shell");
    expect(shell?.classList.contains("embedded")).toBe(true);
    expect(root.querySelector(".shell-sidebar")).toBeNull();
    // The conversation sits flat on the workspace: the panel border, radius and shadow are the host's business now.
    expect(root.querySelector(".shell-main")).not.toBeNull();
  });

  it("keeps the standalone shell exactly as it was by default", async () => {
    const root = await render(false);
    const shell = root.querySelector(".agent-shell");
    expect(shell?.classList.contains("embedded")).toBe(false);
    expect(root.querySelector(".shell-sidebar")).not.toBeNull();
  });

  it("leaves the mobile bar to the host when embedded", async () => {
    const root = await render(true);
    expect(root.querySelector(".mobile-bar")).toBeNull();
  });
});
