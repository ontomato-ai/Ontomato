import { createApp, h, ref, type App, type Ref, shallowRef } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import { assistantAgentsQuerySchema, type PageSkillContext } from "@ontomato/contracts/page-context";
import { createAgentHostClient } from "../host";
import type { ShellLabels } from "../types";
import { pageCounterKey, type PageCounter } from "../page-counter";
import { entryAgent, servePageComposerKey, type PageComposerExpand } from "../page-composer-entry";
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
const pageContext = (applicationId: string, entryKey: string, pageKey: string, memberPath: PageSkillContext["memberPath"] = []): PageSkillContext => ({
  applicationId, entryKey, pageKey, useId: entryKey, panelId: `panel-${entryKey}`,
  path: `/applications/${applicationId}/${entryKey}`, memberPath,
});
const dashboardSkill = pageContext("dashboards", "dashboards-main", "dashboard");
const homeMemberSkill = pageContext("home", "home", "home");
const drawerMemberSkill = pageContext("home", "home", "home", [{ member: "detail", itemKey: { className: "Order", primaryKey: "ord-1" } }]);

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

it("names the page's configuration error in place with the service's reason, disables sending, and chooses no other agent", async () => {
  const drawn = draw({
    pageAgents: async () => Promise.reject(Object.assign(new Error("The page's default agent is unavailable"), { code: "PAGE_DEFAULT_AGENT_UNAVAILABLE" })),
  });
  await new Promise((resolve) => setTimeout(resolve));

  const expected = `${labels.pageAgentUnavailable} The page's default agent is unavailable`;
  expect(drawn.errors).toEqual([expected]);
  // The composer stays in place with the reason visible, disabled, and without substituting another agent.
  expect(drawn.root.querySelector(".page-ask")).not.toBeNull();
  expect(drawn.root.querySelector('.page-ask [role="alert"]')?.textContent).toBe(expected);
  expect(seen).toHaveLength(0);
  expect(box(drawn.root)?.disabled).toBe(true);
  expect(drawn.root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  drawn.root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(drawn.ask).not.toHaveBeenCalled();
});

it("keeps the composer in place with the permission refusal reason on 403 and chooses no other agent", async () => {
  const drawn = draw({
    pageAgents: async () => Promise.reject(Object.assign(new Error("Access denied to page entrance"), { status: 403 })),
  });
  await settle();

  const expected = `${labels.pageAgentUnavailable} Access denied to page entrance`;
  expect(drawn.errors).toEqual([expected]);
  expect(drawn.root.querySelector(".page-ask")).not.toBeNull();
  expect(drawn.root.querySelector('.page-ask [role="alert"]')?.textContent).toBe(expected);
  expect(seen).toHaveLength(0);
  expect(box(drawn.root)?.disabled).toBe(true);
  expect(drawn.ask).not.toHaveBeenCalled();
});

it("keeps the composer in place with the service error disabled when candidates fail to load", async () => {
  // A broken connection is not an empty candidate list: the composer stays in place, shows why, and disables sending.
  const drawn = draw({ pageAgents: async () => Promise.reject(new Error("Failed to fetch")) });
  await new Promise((resolve) => setTimeout(resolve));

  expect(drawn.errors).toEqual(["Failed to fetch"]);
  expect(drawn.root.querySelector(".page-ask")).not.toBeNull();
  expect(drawn.root.querySelector('.page-ask [role="alert"]')?.textContent).toBe("Failed to fetch");
  expect(seen).toHaveLength(0);
  expect(box(drawn.root)?.disabled).toBe(true);
  expect(drawn.root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(drawn.ask).not.toHaveBeenCalled();
});

it("hides the composer without error when the page legitimately returns no enabled candidates", async () => {
  const drawn = draw({ pageAgents: async () => ({ agents: [] }) });
  await settle();

  expect(drawn.errors).toEqual([]);
  expect(drawn.root.querySelector(".page-ask")).toBeNull();
  expect(drawn.served).toHaveLength(0);
});

it("re-queries candidates when the displayed member path changes and clears previous candidates on switch", async () => {
  const skillRef = shallowRef<PageSkillContext | undefined>(homeMemberSkill);
  const drawn = draw({
    pageSkill: skillRef,
    pageAgents: async (skill) => {
      if (skill.memberPath.length === 0) {
        return { agents: [agent("home-agent", "Home")], defaultAgentId: "home-agent" };
      }
      return { agents: [agent("order-agent", "Order")], defaultAgentId: "order-agent" };
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

  // Switching back to the root placement re-queries and replaces the drawer's candidates.
  skillRef.value = homeMemberSkill;
  await new Promise((resolve) => setTimeout(resolve));
  expect(drawn.pageAgents).toHaveBeenLastCalledWith(homeMemberSkill);
  expect(drawn.shown().agentId).toBe("home-agent");
});

it("encodes page entrance queries through the real host client", async () => {
  const requestedUrls: string[] = [];
  const request = vi.fn(async (path: string) => {
    requestedUrls.push(path);
    return new Response(
      JSON.stringify({
        agents: [agent("11111111-1111-4111-8111-111111111111", "Assistant")],
        defaultAgentId: "11111111-1111-4111-8111-111111111111",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const host = createAgentHostClient({ request });

  await host.listPageAgents(dashboardSkill);
  expect(requestedUrls).toHaveLength(1);
  const publicParams = Object.fromEntries(new URL(requestedUrls[0]!, "http://host.test").searchParams);
  expect(assistantAgentsQuerySchema.parse(publicParams)).toEqual({ pageKey: "dashboard", applicationId: "dashboards", entryKey: "dashboards-main" });

  await host.listPageAgents(drawerMemberSkill);
  expect(requestedUrls).toHaveLength(2);
  const memberParams = Object.fromEntries(new URL(requestedUrls[1]!, "http://host.test").searchParams);
  expect(assistantAgentsQuerySchema.parse(memberParams)).toEqual({
    pageKey: "home",
    applicationId: "home",
    entryKey: "home",
  });
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

it("reports an unavailable target explicitly in entryAgent instead of returning a silent fallback", () => {
  const candidates = [agent("assistant", "Assistant"), { ...agent("disabled", "Disabled"), enabled: false }];
  expect(entryAgent({ kind: "page-default" }, candidates, "assistant", undefined)).toEqual({ ok: true, agentId: "assistant" });
  expect(entryAgent({ kind: "page-default" }, candidates, null, undefined)).toEqual({
    ok: false, reason: "unavailable", target: { kind: "page-default" },
  });
  expect(entryAgent({ kind: "id", id: "disabled" }, candidates, "assistant", undefined)).toEqual({
    ok: false, reason: "unavailable", target: { kind: "id", id: "disabled" },
  });
  expect(entryAgent({ kind: "preset", agentKind: "analysis" }, candidates, "assistant", { regular: "assistant" })).toEqual({
    ok: false, reason: "unavailable", target: { kind: "preset", agentKind: "analysis" },
  });
});

it("refuses an entry naming no candidate without opening, reusing the current agent, prefilling, or submitting", async () => {
  localStorage.setItem("ontomato.shell.composerCollapsed", "true");
  try {
    const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")] }) });
    await settle();
    expect(box(drawn.root)).toBeNull();

    for (const target of [
      { kind: "page-default" },
      { kind: "id", id: "stranger" },
      { kind: "preset", agentKind: "knowledge-governance" },
    ] as const) {
      await drawn.served.at(-1)!({ target, prefill: "Not for this agent", submit: true, newSession: true });
      await settle();
      expect(box(drawn.root)).toBeNull();
      expect(drawn.ask).not.toHaveBeenCalled();
    }
    expect(drawn.errors).toEqual([
      labels.pageAgentUnavailable,
      labels.pageAgentUnavailable,
      labels.pageAgentUnavailable,
    ]);
  } finally {
    localStorage.removeItem("ontomato.shell.composerCollapsed");
  }
});

it("takes the preset an entry names when the page says which candidate it is, and refuses one it does not offer", async () => {
  const drawn = draw({
    pageAgents: async () => ({
      agents: [agent("assistant", "Assistant"), agent("governance", "Knowledge governance")],
      defaultAgentId: "assistant",
      presetAgentIds: { regular: "assistant", "knowledge-governance": "governance" },
    }),
  });
  await settle();

  drawn.served.at(-1)!({ target: { kind: "preset", agentKind: "knowledge-governance" }, prefill: "Review the pending knowledge" });
  await settle();
  expect(drawn.shown().agentId).toBe("governance");
  expect(box(drawn.root)!.value).toBe("Review the pending knowledge");

  // A preset that is no candidate here: keep the current agent and text untouched, do not submit, and surface the error.
  await drawn.served.at(-1)!({ target: { kind: "preset", agentKind: "analysis" }, prefill: "Not for this page", submit: true });
  await settle();
  expect(drawn.shown().agentId).toBe("governance");
  expect(box(drawn.root)!.value).toBe("Review the pending knowledge");
  expect(drawn.ask).not.toHaveBeenCalled();
  expect(drawn.errors).toEqual([labels.pageAgentUnavailable]);
});

it("holds an entry made while the page's candidates are being read, and applies it once they arrive", async () => {
  let answer: (value: Awaited<ReturnType<PageCounter["pageAgents"]>>) => void = () => {};
  const drawn = draw({ pageAgents: () => new Promise((resolve) => { answer = resolve; }) });
  await settle();
  // Still reading: the composer is not drawn yet, but it takes the page's entries.
  expect(box(drawn.root)).toBeNull();
  expect(drawn.served).toHaveLength(1);
  drawn.served.at(-1)!({ target: { kind: "preset", agentKind: "knowledge-governance" }, prefill: "Review the pending knowledge" });
  await settle();
  expect(box(drawn.root)).toBeNull();

  answer({
    agents: [agent("assistant", "Assistant"), agent("governance", "Knowledge governance")],
    defaultAgentId: "assistant",
    presetAgentIds: { "knowledge-governance": "governance" },
  });
  await settle();
  expect(drawn.shown().agentId).toBe("governance");
  expect(box(drawn.root)!.value).toBe("Review the pending knowledge");
  expect(drawn.ask).not.toHaveBeenCalled();
});

it("drops an entry that waited and keeps the composer visible in an error disabled state when candidates fail to read", async () => {
  let fail: (reason: Error) => void = () => {};
  const drawn = draw({ pageAgents: () => new Promise((_, reject) => { fail = reject; }) });
  await settle();
  drawn.served.at(-1)!({ target: { kind: "page-default" }, prefill: "Not sent anywhere", submit: true });
  fail(new Error("Failed to fetch"));
  await settle();
  // The composer stays in place explaining the read failure; the waiting entry is neither filled nor sent.
  expect(drawn.errors).toEqual(["Failed to fetch"]);
  expect(drawn.root.querySelector(".page-ask")).not.toBeNull();
  expect(drawn.root.querySelector('.page-ask [role="alert"]')?.textContent).toBe("Failed to fetch");
  expect(box(drawn.root)?.disabled).toBe(true);
  expect(box(drawn.root)?.value).toBe("");
  expect(drawn.ask).not.toHaveBeenCalled();
  expect(drawn.served).toHaveLength(0);
});

it("serves entries only while it is drawn, and withdraws when the page goes", async () => {
  const none = draw({ withoutSkill: true });
  await settle();
  expect(none.served).toHaveLength(0);

  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await settle();
  expect(drawn.served).toHaveLength(1);
  drawn.app.unmount();
  apps.splice(apps.indexOf(drawn.app), 1);
  expect(drawn.served).toHaveLength(0);
});


it("hands a declared submission and its fresh-session choice to the counter on click", async () => {
  const drawn = draw({ pageAgents: async () => ({ agents: [agent("assistant", "Assistant")], defaultAgentId: "assistant" }) });
  await new Promise((resolve) => setTimeout(resolve));
  expect(drawn.ask).not.toHaveBeenCalled();
  await drawn.served.at(-1)!({ target: { kind: "page-default" }, prefill: "Check the current selection", submit: true, newSession: true });
  expect(drawn.ask).toHaveBeenCalledWith("assistant", "Check the current selection", "/dashboards?dashboardId=board-a", {
    submit: true, newSession: true, pageSkill: dashboardSkill,
  });
});
