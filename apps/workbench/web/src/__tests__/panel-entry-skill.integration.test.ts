import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createApp, defineComponent, h, ref, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, useRouter, type Router } from "vue-router";
import { agentHostSendResultSchema } from "@ontomato/contracts/agent-host";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import type { PlatformPreferences } from "@ontomato/platform-admin";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import { installAppHost, installProductEmbedding } from "../../../../../packages/platform-web/src/app-host";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import { platformLayoutRoute } from "../../../../../packages/platform-web/src/layout-route";
import { workbenchPages } from "../../../../../packages/platform-web/src/workbench-routes";
import { providePlatformPageCounter } from "../../../../../packages/platform-web/src/page-counter";
import { startPanelSkillEntryServer } from "../../../../../packages/workbench-server/src/__tests__/fixtures/panel-skill-entry-server";

/*
 * Opening a panel entrance beside the conversation, through to the skill the run installs: one origin answers as Node
 * does — the panel read, the page's candidates, the conversation and its run — with Java, the grants and the runtime's
 * scheduler at their HTTP boundaries (the shared fixture). The page is the platform's own: its chat, the panel route
 * the platform mounts for the address, and the composer the reader writes in. What is pinned is the seam between them:
 * the context the shown instance's read answered is the member the candidates are asked for and the context the run
 * carries, and the run installs that member's skill. The model and its tools do not run; the scheduler stands in at
 * its boundary, and the installed skill is read from the session's sandbox.
 */
type Server = Awaited<ReturnType<typeof startPanelSkillEntryServer>>;
type Seen = { url: URL; method: string; body: unknown; answer: unknown };

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en }, elementLocale: () => elementEn,
});

let server: Server;
const seen: Seen[] = [];
const apps: App[] = [];

beforeAll(async () => {
  server = await startPanelSkillEntryServer();
  // The platform as its shell starts it: the reader's identity, the app host and the panels' message bridge. The origin
  // decides who the reader is, as the fixture's identity does for every request.
  installAuthHost({
    getToken: () => "editor", getApiKey: () => null, getUserInfo: () => null,
    responseStatusError: () => null, verifySessionOnce: async () => "valid", handleAuthExpired: () => {},
  });
  installAppHost({
    credential: { type: "token", token: "editor" },
    preferences: { locale: ref("en"), theme: ref("light") } as PlatformPreferences,
    router: createRouter({ history: createMemoryHistory(), routes: [] }),
    onAuthFailure: () => {},
  });
  installProductEmbedding(createApp({}));
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${server.origin}/`);
  // The page's requests name paths on its own origin, which a browser resolves and this environment's fetch does not: they
  // go to the origin as written. The ones this seam is about are noted with what they carried and got.
  const passOn = globalThis.fetch;
  vi.stubGlobal("fetch", async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url, server.origin);
    const response = await passOn(typeof input === "string" || input instanceof URL ? url : input, init);
    const noted = /^\/api\/product-panels\/[^/]+$/.test(url.pathname) || url.pathname === "/api/assistant/agents"
      || /^\/api\/assistant\/sessions\/[^/]+\/runs$/.test(url.pathname);
    if (noted) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      seen.push({ url, method: init?.method ?? "GET", body, answer: await response.clone().json() });
    }
    return response;
  });
}, 60000);

afterAll(async () => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  await server?.close();
});

/** The agent platform at its own address with the entrance's page beside the conversation, as the platform mounts it. */
async function openBeside(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ ...platformRoutes.chat, component: { render: () => null } }] });
  await router.push({ path: platformRoutes.chat.path, query: { page: path } });
  await router.isReady();
  const app = createApp({ render: () => h(BusinessWorkbench, { defaultLogo: "", defaultBrandName: "Ontomato" }) })
    .use(router).use(workbenchI18n()).use(ElementPlus).use(createPinia())
    .provide(pilotPageKey, pilotPageResolver)
    .provide(platformPageAccessKey, () => true);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  apps.push(app);
  return root;
}

/** The page at its registered address, in the platform's own route table, under a layout giving it the platform's counter. */
async function openAt(path: string) {
  const counter = defineComponent({
    name: "PlatformCounter",
    setup() {
      providePlatformPageCounter(useRouter());
      return () => h(RouterView);
    },
  });
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [platformLayoutRoute(workbenchPages(BusinessWorkbench, { component: { render: () => null } }), counter)],
  });
  await router.push(path);
  await router.isReady();
  const app = createApp(RouterView).use(router).use(workbenchI18n()).use(ElementPlus).use(createPinia())
    .provide(pilotPageKey, pilotPageResolver)
    .provide(platformPageAccessKey, () => true);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  apps.push(app);
  return { root, router };
}

/**
 * The shown instance's reads for its page: the panel's record, read as the panel's alone, and beside it the page skill
 * context Node answers for the page's use relation and entrance — the context the page's composer and its runs carry.
 */
async function readOf(panelId: string) {
  const [record, context] = await vi.waitFor(() => {
    const panel = seen.find((request) => request.url.pathname === `/api/product-panels/${panelId}`);
    const skill = seen.find((request) => request.url.pathname === `/api/product-panels/${panelId}/page-skill-context`);
    expect(panel).toBeDefined();
    expect(skill).toBeDefined();
    return [panel!, skill!] as const;
  }, { timeout: 20000 });
  // The record names no page: what the page reaches is never worked out while the panel waits to be drawn.
  expect(record.url.search).toBe("");
  expect(record.answer).not.toHaveProperty("pageSkillContext");
  return (context.answer as { pageSkillContext: PageSkillContext }).pageSkillContext;
}

/** The page's candidates, asked for one member. */
async function candidatesFor(member: unknown) {
  return vi.waitFor(() => {
    const found = seen.find((request) => request.url.pathname === "/api/assistant/agents" && request.url.searchParams.has("member"));
    expect(found).toBeDefined();
    expect(JSON.parse(found!.url.searchParams.get("member")!)).toEqual(member);
    return found!;
  }, { timeout: 20000 });
}

/** The first run started since the page opened. */
async function firstRun() {
  return vi.waitFor(() => {
    const found = seen.find((request) => request.method === "POST" && /\/runs$/.test(request.url.pathname));
    expect(found).toBeDefined();
    return found!;
  }, { timeout: 30000 });
}

/** The conversation the run went to, as the host's answer names it: the one the run was posted to. */
function sessionOf(run: Seen) {
  const answer = agentHostSendResultSchema.parse(run.answer);
  const posted = run.url.pathname.split("/").at(-2);
  expect(answer.delivery.sessionRef.sessionId).toBe(posted);
  if (answer.snapshot) expect(answer.snapshot.run.sessionId).toBe(posted);
  return answer.delivery.sessionRef.sessionId;
}

/** Writes in a composer and sends, as the reader's Enter does. */
function write(box: HTMLTextAreaElement, text: string) {
  box.value = text;
  box.dispatchEvent(new Event("input"));
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

/** The composer on screen, once the page's candidates let the reader write in it. */
function composer(root: HTMLElement) {
  const box = [...root.querySelectorAll<HTMLTextAreaElement>("textarea")].find((candidate) => !candidate.disabled);
  expect(box).toBeDefined();
  return box!;
}

describe("a panel entrance beside the conversation", () => {
  it.each(["app-business-knowledge-panel", "app-panels-trial-a"])(
    "asks for the shown member's candidates, runs with its context and installs its skill (%s)",
    async (applicationId) => {
      const entry = server.entries.find((candidate) => candidate.applicationId === applicationId)!;
      seen.length = 0;
      const root = await openBeside(entry.path);

      // The shown instance's read answers its member; the candidates are asked for exactly that member.
      const context = await readOf(entry.panelId);
      expect(context).toMatchObject({ mode: "member", locator: entry.entrance });
      const member = context.mode === "member" ? context.member : null;
      expect(member).toMatchObject({ source: { kind: "application-use", applicationId, useId: entry.useId }, memberPath: [] });
      const candidates = await candidatesFor(member);
      expect(candidates.answer).toMatchObject({ defaultAgentId: server.regularAgentId });

      // The reader writes on the page; the run carries the shown instance's context as it was answered.
      write(await vi.waitFor(() => composer(root), { timeout: 20000 }), "What can I do on this page?");
      const run = await firstRun();
      expect((run.body as { pageSkillContext?: PageSkillContext }).pageSkillContext).toEqual(context);

      // That run installed the member's own skill: the fixture checks the prompt's current page and the sandbox copy.
      const sessionId = sessionOf(run);
      const installed = await server.installedSkill(sessionId, member!.ref);
      expect(installed.skill).toEqual(member!.ref);
      expect(installed.digest).toMatch(/^[0-9a-f]{64}$/);
    },
    90000,
  );
});

describe("a panel entrance at its own address", () => {
  it.each(["app-business-knowledge-panel", "app-panels-trial-a"])(
    "sends the first message from the page's foot through the platform's counter with the entrance's member (%s)",
    async (applicationId) => {
      const entry = server.entries.find((candidate) => candidate.applicationId === applicationId)!;
      apps.splice(0).forEach((app) => app.unmount());
      // A new tab: no conversation held with the agent, so the page's message starts one.
      sessionStorage.clear();
      seen.length = 0;
      const { root, router } = await openAt(entry.path);

      // The page at its own address reads its panel; Node answers the member, and the page's composer asks for it.
      const context = await readOf(entry.panelId);
      expect(context).toMatchObject({ mode: "member", locator: entry.entrance });
      const member = context.mode === "member" ? context.member : null;
      expect(member).toMatchObject({ source: { kind: "application-use", applicationId, useId: entry.useId }, memberPath: [] });
      const candidates = await candidatesFor(member);
      expect(candidates.answer).toMatchObject({ defaultAgentId: server.regularAgentId });

      // The reader writes at the page's foot; the counter opens the conversation with this page beside it.
      write(await vi.waitFor(() => composer(root.querySelector<HTMLElement>(".page-ask")!), { timeout: 20000 }), "What can I do on this page?");
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path), { timeout: 20000 });
      expect(router.currentRoute.value.query.page).toBe(entry.path);

      // That first message runs with the entrance's own member, as Node answered it at the page's address.
      const run = await firstRun();
      expect((run.body as { pageSkillContext?: PageSkillContext }).pageSkillContext).toEqual(context);
      const sessionId = sessionOf(run);
      const installed = await server.installedSkill(sessionId, member!.ref);
      expect(installed.skill).toEqual(member!.ref);
      expect(installed.digest).toMatch(/^[0-9a-f]{64}$/);
    },
    90000,
  );
});
