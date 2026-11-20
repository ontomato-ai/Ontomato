import { createApp, h, ref, type App, type Ref, shallowRef } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import { assistantAgentsQuerySchema, type PageSkillContext } from "@ontomato/contracts/page-skills";
import { createAgentHostClient } from "../host";
import type { ShellLabels } from "../types";
import { pageCounterKey, type PageCounter } from "../page-counter";
import { servePageComposerKey, type PageComposerExpand } from "../page-composer-entry";
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
  pageAgentUnavailable: "This page's agent is unavailable", collapseComposer: "Hide", expandComposer: "Ask about this page",
} as Pick<ShellLabels, "placeholder" | "send" | "stop" | "agent" | "pageAgentUnavailable" | "collapseComposer" | "expandComposer">;

const agent = (id: string, name: string): AgentHostAgent => ({ id, name, description: "", icon: null, enabled: true });
const dashboardSkill: PageSkillContext = { mode: "public", locator: { pageKey: "dashboard", access: "domain-member" } };
const homeMemberSkill: PageSkillContext = {
  mode: "member",
  locator: { pageKey: "home", access: "domain-member" },
  member: { source: { kind: "home" }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-home-panel" } },
};
const drawerMemberSkill: PageSkillContext = {
  mode: "member",
  locator: { pageKey: "home", access: "domain-member" },
  member: {
    source: { kind: "object-detail", useId: "use-order", object: { className: "Order", primaryKey: "ord-1" } },
    memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-order-detail" },
  },
};
const unavailableMemberSkill: PageSkillContext = {
  mode: "member",
  locator: { pageKey: "home", access: "domain-member" },
  member: null,
};

const roots: HTMLElement[] = [];
const apps: App[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  roots.splice(0).forEach((root) => root.remove());
});

/** The page's composer, mounted the way a page draws it, over a counter that answers with these agents. */
function draw(
  counter: Partial<Pick<PageCounter, "agents" | "pageAgents">> & { withoutSkill?: boolean; pageSkill?: PageSkillContext | Ref<PageSkillContext | undefined> },
) {
  const pageAgents = vi.fn(counter.pageAgents ?? (async () => ({ agents: [] as AgentHostAgent[] })));
  const agents = vi.fn(counter.agents ?? (async () => [] as AgentHostAgent[]));
  const ask = vi.fn();
  const errors: string[] = [];
  // The host's registry of composers on screen, as the platform keeps it: the latest serves.
  const served: PageComposerExpand[] = [];
  const serve = (expand: PageComposerExpand) => {
    served.push(expand);
    return () => void served.splice(served.indexOf(expand), 1);
  };
  seen.length = 0;
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  const skillRef = counter.withoutSkill
    ? shallowRef<PageSkillContext | undefined>(undefined)
    : counter.pageSkill && "value" in counter.pageSkill
      ? counter.pageSkill
      : shallowRef<PageSkillContext | undefined>(counter.pageSkill ?? dashboardSkill);
  // The picker is the composer's own control; reading its props is how the test sees who the message would go to.
  const app = createApp({
    render: () => h(PageComposer, {
      page: "/dashboards?dashboardId=board-a",
      labels,
      ...(skillRef.value ? { pageSkill: skillRef.value } : {}),
      onError: (message: string) => errors.push(message),
    }),
  });
  app.provide(pageCounterKey as symbol, { pageAgents, agents, ask, preferredAgentId: ref<string | null>("remembered") } satisfies PageCounter);
  app.provide(servePageComposerKey, serve);
  app.mount(root);
  apps.push(app);
  const shown = () => seen.at(-1)!;
  return { app, root, pageAgents, agents, ask, errors, shown, skillRef, served };
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

it("is the page's floating composer: the agent in its upper layer, beside the fold", async () => {
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await new Promise((resolve) => setTimeout(resolve));

  // A page keeps its room: the composer floats over it, its agent chooser above the one line it is written in.
  expect(drawn.root.querySelector(".page-ask .composer.floating")).not.toBeNull();
  expect(drawn.root.querySelector(".page-ask .composer-bar .composer-agent .picker")).not.toBeNull();
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

it("offers no candidates and sends no request when a member context has member: null", async () => {
  const drawn = draw({ pageSkill: unavailableMemberSkill });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.pageAgents).not.toHaveBeenCalled();
  expect(drawn.agents).not.toHaveBeenCalled();
  expect(drawn.errors).toEqual([]);
  expect(drawn.root.querySelector(".page-ask")).toBeNull();
});

it("re-queries candidates when the displayed member changes and clears previous candidates on switch", async () => {
  const skillRef = shallowRef<PageSkillContext | undefined>(homeMemberSkill);
  const drawn = draw({
    pageSkill: skillRef,
    pageAgents: async (skill) => {
      if (skill.mode === "member" && skill.member?.ref.name === "pvt-home-panel") {
        return { agents: [agent("home-agent", "Home")], defaultAgentId: "home-agent" };
      }
      if (skill.mode === "member" && skill.member?.ref.name === "pvt-order-detail") {
        return { agents: [agent("order-agent", "Order")], defaultAgentId: "order-agent" };
      }
      return { agents: [] };
    },
  });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.pageAgents).toHaveBeenCalledWith(homeMemberSkill);
  expect(drawn.shown().agentId).toBe("home-agent");

  // Switching to an object drawer re-queries with the drawer member.
  skillRef.value = drawerMemberSkill;
  await new Promise((resolve) => setTimeout(resolve));
  expect(drawn.pageAgents).toHaveBeenLastCalledWith(drawerMemberSkill);
  expect(drawn.shown().agentId).toBe("order-agent");

  // Switching to member: null clears the previous member's candidates without sending a request.
  const callsBeforeNull = drawn.pageAgents.mock.calls.length;
  skillRef.value = unavailableMemberSkill;
  await new Promise((resolve) => setTimeout(resolve));
  expect(drawn.pageAgents).toHaveBeenCalledTimes(callsBeforeNull);
  expect(drawn.root.querySelector(".page-ask")).toBeNull();
});

it("encodes public and member queries through the real host client and skips network calls for member: null", async () => {
  const requestedUrls: string[] = [];
  const request = vi.fn(async (path: string) => {
    requestedUrls.push(path);
    return new Response(
      JSON.stringify({
        agents: [{ ...agent("11111111-1111-4111-8111-111111111111", "Assistant"), effectiveSkills: [] }],
        defaultAgentId: "11111111-1111-4111-8111-111111111111",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const host = createAgentHostClient({ request });

  await host.listPageAgents(dashboardSkill);
  expect(requestedUrls).toHaveLength(1);
  const publicParams = Object.fromEntries(new URL(requestedUrls[0]!, "http://host.test").searchParams);
  expect(assistantAgentsQuerySchema.parse(publicParams)).toEqual({ pageKey: "dashboard", access: "domain-member" });

  await host.listPageAgents(drawerMemberSkill);
  expect(requestedUrls).toHaveLength(2);
  const memberParams = Object.fromEntries(new URL(requestedUrls[1]!, "http://host.test").searchParams);
  // The member goes as the snapshot gave it, in one parameter, beside the entrance.
  expect(assistantAgentsQuerySchema.parse(memberParams)).toEqual({
    pageKey: "home",
    access: "domain-member",
    member: drawerMemberSkill.mode === "member" ? drawerMemberSkill.member : null,
  });

  const empty = await host.listPageAgents(unavailableMemberSkill);
  expect(empty).toEqual({ agents: [] });
  expect(requestedUrls).toHaveLength(2);
});

/*
 * A panel's conversation entry (design U18) reaches the page's composer through the host's registry: the composer opens,
 * takes the agent the entry names among this page's candidates, and holds the entry's sentence for the reader to send.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve));
const box = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>("textarea");

it("opens on a panel's entry, takes the agent it names among the candidates and fills its sentence, without sending", async () => {
  localStorage.setItem("ontomato.shell.composerCollapsed", "true");
  const drawn = draw({
    pageAgents: async () => ({ agents: [agent("assistant", "Assistant"), agent("governance", "Governance")], defaultAgentId: "assistant" }),
  });
  await settle();
  expect(box(drawn.root)).toBeNull();
  expect(drawn.served).toHaveLength(1);

  drawn.served.at(-1)!({ target: { kind: "id", id: "governance" }, prefill: "Review the pending knowledge" });
  await settle();
  expect(drawn.shown().agentId).toBe("governance");
  expect(box(drawn.root)!.value).toBe("Review the pending knowledge");
  // Opened for this entry: the reader's remembered fold is untouched, and nothing went out.
  expect(localStorage.getItem("ontomato.shell.composerCollapsed")).toBe("true");
  expect(drawn.ask).not.toHaveBeenCalled();

  drawn.served.at(-1)!({ target: { kind: "page-default" }, prefill: "What changed today?" });
  await settle();
  expect(drawn.shown().agentId).toBe("assistant");
  expect(box(drawn.root)!.value).toBe("What changed today?");
  localStorage.removeItem("ontomato.shell.composerCollapsed");
});

it("only opens for an entry naming no candidate, keeping its own agent and its text", async () => {
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await settle();

  for (const target of [{ kind: "id", id: "stranger" }, { kind: "preset", agentKind: "knowledge-governance" }] as const) {
    drawn.served.at(-1)!({ target, prefill: "Not for this agent" });
    await settle();
    expect(drawn.shown().agentId).toBe("assistant");
    expect(box(drawn.root)!.value).toBe("");
  }
});

it("serves entries only while it is drawn, and withdraws when the page goes", async () => {
  const none = draw({ pageSkill: unavailableMemberSkill });
  await settle();
  expect(none.served).toHaveLength(0);

  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await settle();
  expect(drawn.served).toHaveLength(1);
  drawn.app.unmount();
  apps.splice(apps.indexOf(drawn.app), 1);
  expect(drawn.served).toHaveLength(0);
});
