import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { createApp, h, ref, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
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
      const read = await vi.waitFor(() => {
        const found = seen.find((request) => request.url.pathname === `/api/product-panels/${entry.panelId}`);
        expect(found).toBeDefined();
        return found!;
      }, { timeout: 20000 });
      const context = (read.answer as { pageSkillContext: PageSkillContext }).pageSkillContext;
      expect(context).toMatchObject({ mode: "member", locator: entry.entrance });
      const member = context.mode === "member" ? context.member : null;
      expect(member).toMatchObject({ source: { kind: "application-use", applicationId, useId: entry.useId }, memberPath: [] });
      const candidates = await vi.waitFor(() => {
        const found = seen.find((request) => request.url.pathname === "/api/assistant/agents" && request.url.searchParams.has("member"));
        expect(found).toBeDefined();
        return found!;
      }, { timeout: 20000 });
      expect(JSON.parse(candidates.url.searchParams.get("member")!)).toEqual(member);
      expect(candidates.answer).toMatchObject({ defaultAgentId: server.regularAgentId });

      // The reader writes on the page; the run carries the shown instance's context as it was answered.
      const box = await vi.waitFor(() => composer(root), { timeout: 20000 });
      box.value = "What can I do on this page?";
      box.dispatchEvent(new Event("input"));
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      const run = await vi.waitFor(() => {
        const found = seen.find((request) => request.method === "POST" && /\/runs$/.test(request.url.pathname));
        expect(found).toBeDefined();
        return found!;
      }, { timeout: 30000 });
      expect((run.body as { pageSkillContext?: PageSkillContext }).pageSkillContext).toEqual(context);

      // That run installed the member's own skill: the fixture checks the prompt's current page and the sandbox copy.
      const sessionId = run.url.pathname.split("/").at(-2)!;
      const installed = await server.installedSkill(sessionId, member!.ref);
      expect(installed.skill).toEqual(member!.ref);
      expect(installed.digest).toMatch(/^[0-9a-f]{64}$/);
    },
    90000,
  );
});
