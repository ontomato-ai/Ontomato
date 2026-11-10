import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { effectScope, reactive, shallowRef, type EffectScope } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus, { ElMessageBox } from "element-plus";
import en from "element-plus/es/locale/lang/en";
import { createMemoryHistory, createRouter } from "vue-router";
import type { CatalogApplication } from "@ontomato/contracts/platform-identity";
import type { HostedRelease, WorkspaceCommit } from "@ontomato/contracts/workspaces";
import publicEn from "../../../locales/en";
import { installWorkbenchI18n, workbenchI18n } from "../../../i18n";
import PublishDrawer from "../components/PublishDrawer.vue";
import type { AppBuilderPlatform, BuilderPermissions } from "../platform";
import { usePublication } from "../publication";
import type { WorkspaceView } from "../workspace-view";

/*
 * What the drawer keeps: the version marked current is the one Java's catalog says the application opens, never the newest
 * export, and nothing is marked while the catalog cannot be read; rolling back only moves that pointer, through the
 * workspace's rollback, and writes nothing else; a first publication names the application in every language the
 * platform supports; a published application, and only a published one, opens from here as from its rail row; and only
 * an edition with permission management says anything about who can open it.
 */

const sha = (digit: string) => digit.repeat(40);
const COMMITS: WorkspaceCommit[] = [
  { id: sha("3"), parentIds: [sha("2")], createdAt: "2026-11-10T09:00:00.000Z", message: "Add a customer filter" },
  { id: sha("2"), parentIds: [sha("1")], createdAt: "2026-11-10T08:00:00.000Z", message: "Build the overdue board" },
  { id: sha("1"), parentIds: [], createdAt: "2026-11-10T07:00:00.000Z", message: "Initialize workspace" },
];
const APP_ID = "app-0f8e2b1c";
const RELEASES: HostedRelease[] = [
  { appId: APP_ID, releaseId: "release-3", commit: sha("3"), createdAt: "2026-11-10T09:05:00.000Z" },
  { appId: APP_ID, releaseId: "release-2", commit: sha("2"), createdAt: "2026-11-10T08:05:00.000Z" },
];
const APPLICATION: CatalogApplication = {
  id: APP_ID, kind: "hosted", names: { en: "Overdue board", "zh-CN": "逾期看板" }, descriptions: {}, icon: "pages",
  rail: "apps", sort: 100, entry: { path: `/apps/${APP_ID}/` }, entryAccess: [`app:${APP_ID}:entry`],
  scheduleAdapter: null, releaseId: "release-2",
};

/** The workbench as the drawer reaches it: every request is recorded, and the workspace's releases are answered. */
let requests: { method: string; path: string; body: unknown }[] = [];
let releases: HostedRelease[] = [];
function answer(path: string, method: string, body: any): unknown {
  if (method === "GET" && path === "/api/workspaces/w1/releases") return { items: releases };
  if (method === "POST" && path === "/api/workspaces/w1/rollback") return RELEASES.find((release) => release.releaseId === body.releaseId);
  if (method === "POST" && path === "/api/workspaces/w1/publish") return { appId: APP_ID, releaseId: "release-new", commit: body.commit };
  throw new Error(`Unexpected ${method} ${path}`);
}

function catalogOf(applications: CatalogApplication[], error: string | null = null) {
  return { applications: shallowRef(applications), error: shallowRef(error), loading: shallowRef(false), refresh: vi.fn(async () => {}) };
}

const wrappers: ReturnType<typeof mount>[] = [];
const scopes: EffectScope[] = [];
/** The drawer as the builder opens it, on the builder's publication of the workspace. */
function openDrawer(catalog: ReturnType<typeof catalogOf>, permissions: BuilderPermissions | null = null, commits = COMMITS) {
  const view = reactive({
    workspace: { id: "w1", name: "Overdue orders", headCommit: commits[0]!.id, activeRunId: null, createdAt: "", updatedAt: "" },
    commits,
    commitsState: "ready",
  }) as unknown as WorkspaceView;
  const platform: AppBuilderPlatform = {
    subscribePageContext: () => () => {}, catalog, openApplication: vi.fn(), permissions: shallowRef(permissions),
  };
  const scope = effectScope();
  scopes.push(scope);
  const publication = scope.run(() => usePublication(() => "w1", catalog))!;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:any(.*)*", component: { render: () => null } }] });
  const wrapper = mount(PublishDrawer, {
    props: { open: true, view, platform, publication },
    global: { plugins: [ElementPlus, workbenchI18n(), router] },
  });
  wrappers.push(wrapper);
  return { wrapper, platform };
}

const drawer = () => document.body.querySelector<HTMLElement>(".publish-drawer")!;
const rows = () => [...drawer().querySelectorAll<HTMLElement>(".release")];
const rowOf = (commit: string) => rows().find((row) => row.textContent!.includes(commit.slice(0, 7)))!;
const writes = () => requests.filter((request) => request.method !== "GET");

beforeEach(() => {
  requests = [];
  releases = RELEASES;
  vi.stubGlobal("fetch", async (input: string, init?: Parameters<typeof fetch>[1]) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = new URL(input, "http://workbench.test").pathname;
    requests.push({ method, path, body });
    return new Response(JSON.stringify(answer(path, method, body)), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  scopes.splice(0).forEach((scope) => scope.stop());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the publication drawer", () => {
  it("marks as current the release Java's catalog opens, not the newest export", async () => {
    openDrawer(catalogOf([APPLICATION]));
    await flushPromises();

    expect(rowOf(sha("2")).querySelector(".pill")?.textContent).toBe("Current");
    expect(rowOf(sha("3")).querySelector(".pill")).toBeNull();
    expect(rowOf(sha("3")).textContent).toContain("Roll back to this version");
  });

  it("marks nothing while the catalog cannot be read, and shows why", async () => {
    openDrawer(catalogOf([], "Catalog unavailable"));
    await flushPromises();

    expect(drawer().querySelector("[role=alert]")?.textContent).toContain("Catalog unavailable");
    expect(drawer().querySelectorAll(".release .pill")).toHaveLength(0);
    expect(rows().some((row) => row.querySelector("button"))).toBe(false);
    expect(drawer().querySelector<HTMLButtonElement>(".go .el-button--primary")!.disabled).toBe(true);
  });

  it("rolls back by moving the publication only, then reads the catalog again", async () => {
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const catalog = catalogOf([APPLICATION]);
    openDrawer(catalog);
    await flushPromises();

    rowOf(sha("3")).querySelector("button")!.click();
    await flushPromises();

    expect(writes()).toEqual([{
      method: "POST",
      path: "/api/workspaces/w1/rollback",
      body: {
        releaseId: "release-3",
        declaration: { names: APPLICATION.names, descriptions: {}, icon: "pages", groups: [], permissions: [] },
      },
    }]);
    expect(catalog.refresh).toHaveBeenCalledTimes(1);
  });

  it("offers no commit to publish before the agent has written files", async () => {
    releases = [];
    openDrawer(catalogOf([]), null, COMMITS.slice(2));
    await flushPromises();

    expect(drawer().querySelector(".go")!.textContent).toContain("No commit holds files yet");
    expect(drawer().querySelector<HTMLButtonElement>(".go .el-button--primary")!.disabled).toBe(true);
  });

  it("names a first publication in every language the platform supports and publishes the newest commit with files", async () => {
    const language = (supported: ("zh-CN" | "en")[]) => installWorkbenchI18n({
      supported, defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
      messages: { en: publicEn }, elementLocale: () => en,
    });
    language(["zh-CN", "en"]);
    onTestFinished(() => void language(["en"]));
    releases = [];
    const catalog = catalogOf([]);
    openDrawer(catalog);
    await flushPromises();

    const name = drawer().querySelector<HTMLInputElement>("#publish-name")!;
    expect(name.value).toBe("Overdue orders");
    name.value = "Overdue board";
    name.dispatchEvent(new Event("input"));
    await flushPromises();
    const releaseReads = () => requests.filter((request) => request.path === "/api/workspaces/w1/releases").length;
    const readsBefore = releaseReads();
    drawer().querySelector<HTMLButtonElement>(".go .el-button--primary")!.click();
    await flushPromises();

    expect(writes()).toEqual([{
      method: "POST",
      path: "/api/workspaces/w1/publish",
      body: {
        commit: sha("3"),
        declaration: {
          names: { "zh-CN": "Overdue board", en: "Overdue board" }, descriptions: {}, icon: "pages", groups: [], permissions: [],
        },
      },
    }]);
    expect(catalog.refresh).toHaveBeenCalledTimes(1);
    expect(releaseReads()).toBe(readsBefore + 1);
  });

  it("opens the application from its rail row's entry, and only while it is published", async () => {
    const { platform } = openDrawer(catalogOf([APPLICATION]));
    await flushPromises();
    const open = [...drawer().querySelectorAll<HTMLButtonElement>(".app button")].find((button) => button.textContent!.includes("Open on the rail"))!;
    open.click();
    expect(platform.openApplication).toHaveBeenCalledWith(APP_ID);
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";

    openDrawer(catalogOf([]));
    await flushPromises();
    expect(drawer().textContent).not.toContain("Open on the rail");
  });

  it("says who can open the application only where the edition manages permissions", async () => {
    openDrawer(catalogOf([APPLICATION]));
    await flushPromises();
    expect(drawer().textContent).not.toContain("Who can open it");
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";

    openDrawer(catalogOf([APPLICATION]), { path: "/permissions", open: true });
    await flushPromises();
    const link = drawer().querySelector<HTMLAnchorElement>(".access a")!;
    expect(link.textContent).toContain("Grant access in Permissions");
    expect(link.getAttribute("href")).toBe("/permissions");
    expect(link.target).toBe("_blank");
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";

    openDrawer(catalogOf([APPLICATION]), { path: "/permissions", open: false });
    await flushPromises();
    expect(drawer().querySelector(".access a")).toBeNull();
    expect(drawer().textContent).toContain("ask an administrator");
  });
});
