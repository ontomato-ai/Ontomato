import { createApp, h, ref, type App } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { AgentPageQuery } from "../host";
import type { ShellLabels } from "../types";
import { pageCounterKey, type PageCounter } from "../page-counter";
import PageComposer from "../components/PageComposer.vue";

// The composer's own agent control: the test reads who the page offers and who is selected, which is the point.
const seen: { agents: readonly AgentHostAgent[]; agentId: string | null }[] = [];
vi.mock("../components/AgentPicker.vue", () => ({
  default: {
    name: "AgentPicker",
    props: ["agents", "agentId", "label"],
    emits: ["select"],
    setup(props: { agents: readonly AgentHostAgent[]; agentId: string | null }) {
      return () => {
        seen.push({ agents: props.agents, agentId: props.agentId });
        return h("span", { class: "picker" }, String(props.agentId));
      };
    },
  },
}));

/*
 * The composer at the foot of a page at its own address offers what that page can be worked on with. A page that
 * declares its own skill offers only the agents carrying it, and starts from the page's registered default — the agent
 * this tab last used is a choice only when it is one of them, and a page whose default is gone says so instead of
 * choosing another one.
 */
const labels = {
  placeholder: "Ask", send: "Send", stop: "Stop", agent: "Agent",
  pageAgentUnavailable: "This page's agent is unavailable",
} as Pick<ShellLabels, "placeholder" | "send" | "stop" | "agent" | "pageAgentUnavailable">;

const agent = (id: string, name: string): AgentHostAgent => ({ id, name, description: "", icon: null, enabled: true });
const dashboardSkill: AgentPageQuery = { pageKey: "dashboard", access: "domain-member" };

const roots: HTMLElement[] = [];
const apps: App[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  roots.splice(0).forEach((root) => root.remove());
});

/** The page's composer, mounted the way a page draws it, over a counter that answers with these agents. */
function draw(counter: Partial<Pick<PageCounter, "agents" | "pageAgents">> & { withoutSkill?: boolean }) {
  const pageAgents = vi.fn(counter.pageAgents ?? (async () => ({ agents: [] as AgentHostAgent[] })));
  const agents = vi.fn(counter.agents ?? (async () => [] as AgentHostAgent[]));
  const ask = vi.fn();
  const errors: string[] = [];
  seen.length = 0;
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  // The picker is the composer's own control; reading its props is how the test sees who the message would go to.
  const app = createApp({
    render: () => h(PageComposer, {
      page: "/dashboards?dashboardId=board-a",
      labels,
      ...(counter.withoutSkill ? {} : { pageSkill: dashboardSkill }),
      onError: (message: string) => errors.push(message),
    }),
  });
  app.provide(pageCounterKey as symbol, { pageAgents, agents, ask, preferredAgentId: ref<string | null>("remembered") } satisfies PageCounter);
  app.mount(root);
  apps.push(app);
  const shown = () => seen.at(-1)!;
  return { root, pageAgents, agents, ask, errors, shown };
}

it("offers only the page's candidates and starts from its registered default", async () => {
  // The remembered agent is not a candidate here: the page's default is selected instead of it.
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.pageAgents).toHaveBeenCalledWith(dashboardSkill);
  expect(drawn.agents).not.toHaveBeenCalled();
  expect(drawn.shown().agents.map((item) => item.id)).toEqual(["assistant"]);
  expect(drawn.shown().agentId).toBe("assistant");
});

it("starts from the page's registered default even when the remembered agent is also a candidate", async () => {
  // The reader has just talked to the remembered agent; this page is mapped to another one, and starts on it.
  const drawn = draw({
    pageAgents: async () => ({ agents: [agent("governance", "Knowledge governance"), agent("remembered", "Assistant")], defaultAgentId: "governance" }),
  });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.shown().agents.map((item) => item.id)).toEqual(["governance", "remembered"]);
  expect(drawn.shown().agentId).toBe("governance");
});

it("starts from the platform's own agent for a page that registered no default", async () => {
  // Without a registered default the directory names the platform's own agent as the default; it is chosen, not the
  // remembered one.
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant"), agent("remembered", "Analyst")] }) });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.shown().agentId).toBe("assistant");
});

it("is the page's one-row composer: the agent on its row, and not opened until the message needs it", async () => {
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await new Promise((resolve) => setTimeout(resolve));

  // A page keeps its room: the composer at its foot starts as one row, with the agent chooser on that row.
  expect(drawn.root.querySelector(".page-ask .composer")).not.toBeNull();
  expect(drawn.root.querySelector(".page-ask .composer.open")).toBeNull();
  expect(drawn.root.querySelector(".page-ask .composer .composer-agent .picker")).not.toBeNull();
});

it("offers every agent to a page without a skill, and keeps the remembered one", async () => {
  const drawn = draw({ agents: async () => [agent("remembered", "Analyst"), agent("other", "Other")], withoutSkill: true });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.pageAgents).not.toHaveBeenCalled();
  expect(drawn.shown().agents.map((item) => item.id)).toEqual(["remembered", "other"]);
  expect(drawn.shown().agentId).toBe("remembered");
});

it("names the page's configuration error with the service's reason, rather than choosing another agent", async () => {
  const drawn = draw({
    pageAgents: async () => Promise.reject(Object.assign(new Error("The page's default agent is unavailable"), { code: "PAGE_DEFAULT_AGENT_UNAVAILABLE" })),
  });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.errors).toEqual([`${labels.pageAgentUnavailable} The page's default agent is unavailable`]);
  // No agent, no composer: the page cannot be asked to work on what it cannot do.
  expect(drawn.root.querySelector(".page-ask")).toBeNull();
});

it("shows the service's own error when the candidates could not be read at all", async () => {
  // A broken connection is not a misconfigured page: the reader sees what went wrong.
  const drawn = draw({ pageAgents: async () => Promise.reject(new Error("Failed to fetch")) });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.errors).toEqual(["Failed to fetch"]);
});
