import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import AgentShell from "../components/AgentShell.vue";
import { testDisplay } from "./display";
import { useAgentNav } from "../useAgentNav";
import { servePageComposerKey, type PageComposerExpand } from "../page-composer-entry";
import { createAgentHostClient, type AgentHostClient } from "../host";
import type { ShellFeatureDeclaration, ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * The column's head of an application that runs on several agents is its agent chooser, always: it says which agent
 * the conversation runs on. A page open beside the conversation narrows what the chooser lists to the page's candidates
 * — one candidate is still a chooser, showing that agent — and closing the page lists every agent again. Opening the
 * address with the page already beside the conversation and opening the page later end the same way. An application
 * that runs on one agent heads its column with its own name.
 */
const labels = {
  placeholder: "Message",
  send: "Send",
  stop: "Stop",
  agent: "Agent",
  newConversation: "New chat",
  pageContext: (page: { label: string; url: string }) => `Current page: ${page.label} (${page.url})`,
  pageContextAddress: (url: string) => `Current page: ${url}`,
  selectionContext: (selection: string) => `Selected: ${selection}`,
  fileContext: (file: { label: string; path: string }) => `Current file: ${file.label} (${file.path})`,
  pageContextClosed: "Current page: closed",
} as unknown as ShellLabels;
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
  pageSkill: { mode: "public", locator: { pageKey: "dashboard", access: "domain-member" } },
};
const panel: ShellFeatureDeclaration = {
  id: "panel-application", label: "Panel", icon: "dashboard", availability: "page", listed: false, withConversation: true,
};
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "OntoPlato", features: [board, panel] };

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
  const display = testDisplay(workbench, {
    initial: options.page ? { page: { featureId: options.page, address: `/${options.page}`, instance: options.page }, view: "side" } : undefined,
  });
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
        onLeaveConversation: () => void display.close(),
      });
      // The application loads its agents once it is mounted, as the agent platform does.
      void nav.loadAgents();
      return () =>
        h(AgentShell, {
          workbench: { ...workbench, label: options.title ?? workbench.label }, client: host, labels, nav,
          agentPicker: options.agentPicker ?? true, title: options.title ?? workbench.label,
          agentId: agentId.value, "onUpdate:agentId": (id: string | null) => (agentId.value = id),
          display,
        });
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  return { root, display, agentId };
}

/** What the column's head shows, and the agents its chooser lists when opened. */
/** The page skill member a candidates request carried, decoded from its single parameter. */
function memberOf(url: string): unknown {
  return JSON.parse(new URL(url, "http://host.test").searchParams.get("member") ?? "null");
}

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
  const { root, display } = render({ page: null });
  await settle();
  expect((await head(root)).listed).toEqual(["Assistant", "Analyst", "Knowledge governance"]);

  await display.openFeature("dashboards", "side");
  await settle();
  // Switching to the native page's default candidate before any conversation starts must not close the page.
  expect(display.page.value?.featureId).toBe("dashboards");
  const beside = await head(root);
  expect(beside.chooser).toBe(true);
  expect(beside.listed).toEqual(["Assistant"]);
  expect(beside.shown).toBe("Assistant");

  await display.close();
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

it("floats the composer over a page open full beside the conversation, in the page's shape", async () => {
  // Full, the page fills the workspace and the conversation's composer floats over it: the page's shape, not a third one.
  const host = client();
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({ client: () => host, agentId: () => assistant, setAgentId: () => {}, sessionId: () => null, setSessionId: () => {} });
      void nav.loadAgents();
      const display = testDisplay(workbench, {
        initial: { page: { featureId: "dashboards", address: "/dashboards", instance: "dashboards" }, view: "full" },
      });
      return () => h(AgentShell, { workbench, display, client: host, labels, nav, agentPicker: true, agentId: assistant });
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  await settle();

  expect(root.querySelector(".pane-dock .composer.floating")).not.toBeNull();
  expect(root.querySelector(".pane-dock .composer-fold")).not.toBeNull();
});

it("keeps the conversation's own composer when only the conversation is open", async () => {
  const { root } = render({ page: null });
  await settle();
  expect(root.querySelector(".shell-main .composer")).not.toBeNull();
  expect(root.querySelector(".shell-main .composer.floating")).toBeNull();
});

it("narrows candidates from display-skill, re-queries on member switch, skips requests for member: null, and clears on close or instance switch", async () => {
  const requests: string[] = [];
  const homeSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: { source: { kind: "home" }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-home-panel" } },
  };
  const drawerSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: { source: { kind: "object-detail", useId: "use-1", object: { className: "Order", primaryKey: "1" } }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-drawer-panel" } },
  };
  const nullSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: null,
  };
  const wire = (items: typeof every) => items.map((item) => ({ ...item, effectiveSkills: [] }));
  const request = vi.fn(async (path: string) => {
    requests.push(path);
    const url = new URL(path, "http://host.test");
    if (url.pathname.endsWith("/sessions")) {
      return new Response(JSON.stringify({ sessions: [], nextCursor: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const memberKey = (JSON.parse(url.searchParams.get("member") ?? "null") as { ref: { name: string } } | null)?.ref.name ?? null;
    if (memberKey === "pvt-home-panel") {
      return new Response(JSON.stringify({ agents: wire([every[0]]), defaultAgentId: assistant }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (memberKey === "pvt-drawer-panel") {
      return new Response(JSON.stringify({ agents: wire([every[2]]), defaultAgentId: governance }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.searchParams.get("pageKey") === "dashboard") {
      return new Response(JSON.stringify({ agents: wire([every[0]]), defaultAgentId: assistant }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ agents: wire(every) }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const host = createAgentHostClient({ request });
  const display = testDisplay(workbench, {
    resolve: (address) =>
      address.startsWith("/applications/")
        ? { featureId: "panel-application", address, instance: address.split("?")[0]! }
        : address === "/dashboards"
          ? { featureId: "dashboards", address, instance: "dashboards" }
          : null,
    initial: { page: { featureId: "panel-application", address: "/applications/app/home", instance: "/applications/app/home" }, view: "side" },
  });
  const agentId = ref<string | null>(analyst);
  const leftConversation = vi.fn();
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => host,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => null,
        setSessionId: () => {},
        onLeaveConversation: leftConversation,
      });
      void nav.loadAgents();
      return () =>
        h(AgentShell, {
          workbench, client: host, labels, nav, agentPicker: true, title: workbench.label,
          agentId: agentId.value, "onUpdate:agentId": (id: string | null) => (agentId.value = id),
          display,
        });
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  await settle();

  // Panel reports its home member skill: candidates narrow to the home member's agents.
  display.skill(homeSkill);
  await settle();
  expect((await head(root)).listed).toEqual(["Assistant"]);
  expect(agentId.value).toBe(assistant);
  // The candidates request carries the member exactly as the shown page's snapshot named it: source, path and ref.
  expect(requests.map(memberOf)).toContainEqual(homeSkill.mode === "member" ? homeSkill.member : null);
  expect(leftConversation).not.toHaveBeenCalled();

  // Switching to an object drawer re-emits display-skill with the drawer member and re-queries.
  display.skill(drawerSkill);
  await settle();
  expect((await head(root)).listed).toEqual(["Knowledge governance"]);
  expect(agentId.value).toBe(governance);
  expect(requests.map(memberOf)).toContainEqual(drawerSkill.mode === "member" ? drawerSkill.member : null);
  expect(leftConversation).not.toHaveBeenCalled();

  // Reporting member: null sends no /agents request, clears candidates, and keeps the panel open.
  const agentRequestsBeforeNull = requests.filter((url) => url.includes("/agents")).length;
  display.skill(nullSkill);
  await settle();
  expect(requests.filter((url) => url.includes("/agents")).length).toBe(agentRequestsBeforeNull);
  expect((await head(root)).listed).toEqual([]);
  expect(agentId.value).toBeNull();
  expect(display.page.value?.address).toBe("/applications/app/home");
  expect(leftConversation).not.toHaveBeenCalled();

  // Navigating to a different instance (native dashboards) clears display.pageSkill and falls back to the feature's public pageSkill.
  await display.navigate("/dashboards", { view: "side", history: "push" });
  await settle();
  expect(display.pageSkill.value).toBeNull();
  expect((await head(root)).listed).toEqual(["Assistant"]);
  expect(requests.some((url) => url.includes("pageKey=dashboard&access=domain-member"))).toBe(true);

  // Closing the page lists every agent again.
  await display.close();
  await settle();
  expect((await head(root)).listed).toEqual(["Assistant", "Analyst", "Knowledge governance"]);
});

it("keeps an active conversation on its own agent when new page candidates exclude it, and still lets the reader switch from the chooser", async () => {
  const existingSessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const runId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const sentBodies: { path: string; message: string; pageSkillContext?: PageSkillContext }[] = [];
  const homeSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: { source: { kind: "home" }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-home-panel" } },
  };
  const drawerSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: { source: { kind: "object-detail", useId: "use-1", object: { className: "Order", primaryKey: "1" } }, memberPath: [], ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-drawer-panel" } },
  };
  const session = {
    id: existingSessionId,
    agentId: assistant,
    title: "Existing chat",
    origin: "user",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    latestRun: null,
  };
  const wire = (items: typeof every) => items.map((item) => ({ ...item, effectiveSkills: [] }));
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://host.test");
    if (url.pathname.endsWith("/history")) {
      return new Response(JSON.stringify({
        session,
        messages: [],
        runs: [],
        latestRun: null,
        pendingQuestions: [],
        page: { messageSeq: 0, olderCursor: null },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/runs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { message: string; pageSkillContext?: PageSkillContext };
      sentBodies.push({ path: url.pathname, message: body.message, ...(body.pageSkillContext ? { pageSkillContext: body.pageSkillContext } : {}) });
      return new Response(JSON.stringify({
        delivery: {
          messageId: runId,
          sessionRef: { providerId: "workbench", sessionId: existingSessionId },
          runId,
          delivery: "run",
          status: "stopped",
        },
        input: {
          id: runId,
          runId,
          messageSeq: 1,
          contextSeq: 1,
          message: { role: "user", content: body.message, timestamp: 1 },
        },
        snapshot: {
          pendingQuestions: [],
          run: {
            id: runId,
            sessionId: existingSessionId,
            status: "stopped",
            stopReason: "stop",
            errorMessage: null,
            answerMessageId: null,
            workspaceCommit: null,
            createdAt: new Date(0).toISOString(),
            finishedAt: null,
            resolvedSkills: [],
          },
          cursor: { runId, seq: 1, streamId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
          messages: [],
          pendingMessages: [],
          toolExecutions: [],
          artifacts: [],
        },
        pendingQuestions: [],
        replayed: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/sessions")) {
      return new Response(JSON.stringify({ sessions: [session], nextCursor: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const memberKey = (JSON.parse(url.searchParams.get("member") ?? "null") as { ref: { name: string } } | null)?.ref.name ?? null;
    if (memberKey === "pvt-home-panel") {
      return new Response(JSON.stringify({ agents: wire([every[0]]), defaultAgentId: assistant }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (memberKey === "pvt-drawer-panel") {
      return new Response(JSON.stringify({ agents: wire([every[2]]), defaultAgentId: governance }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.searchParams.get("pageKey") === "dashboard") {
      return new Response(JSON.stringify({ agents: wire([every[1]]), defaultAgentId: analyst }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ agents: wire(every) }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const host = createAgentHostClient({ request });
  const display = testDisplay(workbench, {
    resolve: (address) =>
      address.startsWith("/applications/")
        ? { featureId: "panel-application", address, instance: address.split("?")[0]! }
        : address === "/dashboards"
          ? { featureId: "dashboards", address, instance: "dashboards" }
          : null,
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label ?? (page.featureId === "dashboards" ? "Dashboards" : "Home"),
      selection: reported?.selection ?? [],
    }),
    initial: { page: { featureId: "panel-application", address: "/applications/app/home", instance: "/applications/app/home" }, view: "side" },
  });
  const agentId = ref<string | null>(assistant);
  const sessionId = ref<string | null>(existingSessionId);
  const leftConversation = vi.fn(() => void display.close());
  let currentNav!: ReturnType<typeof useAgentNav>;
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => host,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
        onLeaveConversation: leftConversation,
      });
      currentNav = nav;
      void nav.loadAgents();
      return () =>
        h(AgentShell, {
          workbench,
          client: host,
          labels,
          nav,
          agentPicker: true,
          title: workbench.label,
          agentId: agentId.value,
          "onUpdate:agentId": (id: string | null) => (agentId.value = id),
          sessionId: sessionId.value,
          "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
          display,
        });
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  await settle();

  // Start on the home member where Assistant is a candidate.
  display.skill(homeSkill);
  await settle();
  expect((await head(root)).shown).toBe("Assistant");
  expect(agentId.value).toBe(assistant);

  // Switch to the drawer member whose candidates exclude Assistant: the open conversation stays on Assistant.
  display.context({
    url: "/applications/app/home",
    label: "Order detail",
    selection: [{ kind: "object", id: "Order:1", label: "Order #1" }],
  });
  display.skill(drawerSkill);
  await settle();

  expect(agentId.value).toBe(assistant);
  expect(sessionId.value).toBe(existingSessionId);
  expect(display.page.value?.address).toBe("/applications/app/home");
  expect(leftConversation).not.toHaveBeenCalled();

  const afterMemberSwitch = await head(root);
  expect(afterMemberSwitch.shown).toBe("Assistant");
  expect(afterMemberSwitch.listed).toEqual(["Knowledge governance"]);

  const input = root.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  expect(input.disabled).toBe(false);
  input.value = "Explain this order";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  const sendButton = root.querySelector<HTMLButtonElement>(".composer-button")!;
  expect(sendButton.disabled).toBe(false);
  sendButton.click();
  await settle();

  expect(sentBodies).toHaveLength(1);
  expect(sentBodies[0]!.path).toBe(`/sessions/${existingSessionId}/runs`);
  expect(sentBodies[0]!.message).toContain("Explain this order");
  expect(sentBodies[0]!.message).toContain("Current page: Order detail (/applications/app/home)");
  expect(sentBodies[0]!.message).toContain("Selected: Order #1");
  // The message carries the page shown as it left, as that page's own snapshot named it; the server checks it again.
  expect(sentBodies[0]!.pageSkillContext).toEqual(drawerSkill);

  // Opening a native page whose candidates exclude Assistant follows the same rule and keeps the page open.
  await display.navigate("/dashboards", { view: "side", history: "push" });
  await settle();
  expect(agentId.value).toBe(assistant);
  expect(sessionId.value).toBe(existingSessionId);
  expect(display.page.value?.address).toBe("/dashboards");
  expect(leftConversation).not.toHaveBeenCalled();
  const onNativePage = await head(root);
  expect(onNativePage.shown).toBe("Assistant");
  expect(onNativePage.listed).toEqual(["Analyst"]);
  expect(root.querySelector<HTMLTextAreaElement>(".composer textarea")!.disabled).toBe(false);

  // The reader choosing another candidate from the dropdown follows the normal agent-switch path.
  root.querySelector<HTMLButtonElement>(".shell-nav-body .switch-trigger")!.click();
  await settle();
  const option = [...document.querySelectorAll<HTMLButtonElement>(".agent-menu .agent-option")].find((item) =>
    item.textContent?.includes("Analyst"),
  )!;
  option.click();
  await settle();

  expect(agentId.value).toBe(analyst);
  expect(sessionId.value).toBeNull();
  expect(leftConversation).toHaveBeenCalledTimes(1);
  expect(display.page.value).toBeNull();
  expect(currentNav.currentAgent.value?.id).toBe(analyst);
  expect((await head(root)).shown).toBe("Analyst");
});

/*
 * A panel's conversation entry on the page beside the conversation (design U18): the agent it names is this
 * conversation's, so its sentence is filled here; another of the page's candidates starts a new conversation with that
 * agent, the page staying open and the old conversation keeping its agent; an agent the page does not offer only opens.
 */
it("fills a panel's entry into this conversation, or starts one with the agent it names, keeping the page beside it", async () => {
  const existingSessionId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const drawerSkill: PageSkillContext = {
    mode: "member",
    locator: { pageKey: "home", access: "domain-member" },
    member: {
      source: { kind: "object-detail", useId: "use-1", object: { className: "Order", primaryKey: "1" } },
      memberPath: [],
      ref: { namespace: { kind: "domain", domainId: "domain-1" }, name: "pvt-drawer-panel" },
    },
  };
  const session = {
    id: existingSessionId, agentId: assistant, title: "Existing chat", origin: "user",
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun: null,
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const wire = (items: typeof every) => items.map((item) => ({ ...item, effectiveSkills: [] }));
  const request = vi.fn(async (path: string) => {
    const url = new URL(path, "http://host.test");
    if (url.pathname.endsWith("/history"))
      return json({ session, messages: [], runs: [], latestRun: null, pendingQuestions: [], page: { messageSeq: 0, olderCursor: null } });
    if (url.pathname.endsWith("/sessions")) return json({ sessions: [session], nextCursor: null });
    const member = JSON.parse(url.searchParams.get("member") ?? "null") as { ref: { name: string } } | null;
    if (member?.ref.name === "pvt-drawer-panel")
      return json({ agents: wire([every[0]!, every[2]!]), defaultAgentId: governance, presetAgentIds: { regular: assistant, "knowledge-governance": governance } });
    return json({ agents: wire(every) });
  });
  const host = createAgentHostClient({ request });
  const display = testDisplay(workbench, {
    resolve: (address) => (address.startsWith("/applications/") ? { featureId: "panel-application", address, instance: address.split("?")[0]! } : null),
    context: (page, reported) => ({ url: page.address, label: reported?.label ?? "Home", selection: reported?.selection ?? [] }),
    initial: { page: { featureId: "panel-application", address: "/applications/app/home", instance: "/applications/app/home" }, view: "side" },
  });
  const agentId = ref<string | null>(assistant);
  const sessionId = ref<string | null>(existingSessionId);
  const leftConversation = vi.fn(() => void display.close());
  const served: PageComposerExpand[] = [];
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => host,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
        onLeaveConversation: leftConversation,
      });
      void nav.loadAgents();
      return () =>
        h(AgentShell, {
          workbench, client: host, labels, nav, agentPicker: true, title: workbench.label, display,
          agentId: agentId.value, "onUpdate:agentId": (id: string | null) => (agentId.value = id),
          sessionId: sessionId.value, "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
        });
    },
  });
  app = createApp(Host);
  app.provide(servePageComposerKey, (expand: PageComposerExpand) => {
    served.push(expand);
    return () => void served.splice(served.indexOf(expand), 1);
  });
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  await settle();
  display.skill(drawerSkill);
  await settle();
  const written = () => [...root.querySelectorAll<HTMLTextAreaElement>("textarea")].map((box) => box.value);
  expect(served).toHaveLength(1);

  // The agent it names is this conversation's: the sentence waits here, and nothing else moves.
  served.at(-1)!({ target: { kind: "id", id: assistant }, prefill: "About this order" });
  await settle();
  expect(written()).toContain("About this order");
  expect(sessionId.value).toBe(existingSessionId);
  expect(agentId.value).toBe(assistant);

  // Another candidate (the page's default here): a new conversation with it, the page still beside it.
  served.at(-1)!({ target: { kind: "page-default" }, prefill: "Review the pending knowledge" });
  await settle();
  expect(agentId.value).toBe(governance);
  expect(sessionId.value).toBeNull();
  expect(display.page.value?.address).toBe("/applications/app/home");
  expect(leftConversation).not.toHaveBeenCalled();
  expect(written()).toContain("Review the pending knowledge");

  // An agent the page does not offer: the composer only opens, on the agent it has.
  served.at(-1)!({ target: { kind: "id", id: analyst }, prefill: "Not for this page" });
  await settle();
  expect(agentId.value).toBe(governance);
  expect(written()).not.toContain("Not for this page");

  // A preset the page offers, named by the server's answer: a new conversation with that candidate takes the sentence.
  served.at(-1)!({ target: { kind: "preset", agentKind: "regular" }, prefill: "Back to the assistant" });
  await settle();
  expect(agentId.value).toBe(assistant);
  expect(written()).toContain("Back to the assistant");
  expect(request.mock.calls.some(([path]) => String(path).includes("/runs"))).toBe(false);
});
