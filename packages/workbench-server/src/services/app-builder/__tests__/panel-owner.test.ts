import { beforeEach, expect, it, vi } from "vitest";
import { panelFormDescriptionSchema, panelRecordListSchema, panelRecordQuerySchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import {
  AGENT_SESSION, APPLICATION, APP_WORKSPACE, APP_WORKSPACE_CREATE, APP_WORKSPACE_DELETE, APP_WORKSPACE_PUBLISH,
  APP_WORKSPACE_RESTART_BUILD_TEST, APP_WORKSPACE_RESTORE_COMMIT, APP_WORKSPACE_ROLLBACK_RELEASE,
  APP_WORKSPACE_SAVE, APP_WORKSPACE_UPDATE_PUBLISHED_ICON, isPlatformFormSaveOperation, platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { appWorkspaceServerOperations } from "../panel-operations";
import { AppWorkspaceOwner } from "../panel-reads";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), bytes: vi.fn(), client: vi.fn(), access: vi.fn(), sessions: vi.fn(), releases: vi.fn(),
  current: vi.fn(), stop: vi.fn(), start: vi.fn(), deleteSession: vi.fn(), publish: vi.fn(), rollback: vi.fn(), put: vi.fn(),
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    constructor(...args: unknown[]) { mocks.client(...args); }
    request = mocks.request;
    bytes = mocks.bytes;
  },
}));
vi.mock("../../../config/data-query-api", () => ({ getApiConfig: () => null, buildUrl: (_config: unknown, path: string) => path }));
vi.mock("../../../utils/backend-client", () => ({ backendPut: mocks.put }));
vi.mock("../access", () => ({ assertAppBuilderAccess: mocks.access }));
vi.mock("../build-tests", () => ({
  WorkspaceBuildTests: class {
    current = mocks.current;
    stop = mocks.stop;
    start = mocks.start;
  },
}));
vi.mock("../../workspaces/sessions", () => ({ workspaceSessions: mocks.sessions }));
vi.mock("../../workspaces/hosted-apps", () => ({
  workspaceReleases: mocks.releases, publishWorkspace: mocks.publish, rollbackWorkspace: mocks.rollback,
}));
vi.mock("../../assistant/service", () => ({ assistantService: { delete: mocks.deleteSession } }));

const id = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const oldReleaseId = "55555555-5555-4555-8555-555555555555";
const head = "a".repeat(40), previous = "b".repeat(40), initial = "c".repeat(40);
const now = "2026-11-25T00:00:00.000Z";
const workspace = { id, name: "Supply", headCommit: head, activeRunId: null as string | null, createdAt: now, updatedAt: now };
const actor = { owner: { domainId: "domain", userId: "owner" }, credentials: { token: "caller", locale: "en" } };
const host: PanelOperationHost = {
  initiator: actor, executor: actor, locale: "en", request: vi.fn(), requestWorkbench: vi.fn(),
};
const target = { kind: "object", objectType: APP_WORKSPACE, primaryKey: id } as const;
const path = `/v1/workspaces/${id}`;
const patch = "diff --git a/index.html b/index.html\n@@ -1 +1 @@\n-Old\n+New\n";
const app = { id: "app-stock", names: { en: "Inventory" }, descriptions: { en: "Counts" }, entry: { path: "/apps/app-stock/" }, icon: "folder", releaseId };
const releases = [
  { appId: app.id, releaseId, commit: head, createdAt: now },
  { appId: app.id, releaseId: oldReleaseId, commit: previous, createdAt: now },
];
const commits = [
  { id: head, parentIds: [previous], message: "Add a page", createdAt: now },
  { id: previous, parentIds: [initial], message: "Add files", createdAt: now },
  { id: initial, parentIds: [], message: "Initialize", createdAt: now },
];
const tree = { files: ["data.bin", "src/main.js", "index.html", "panel.html", "panel.json"].map(path => ({ path, size: 10 })) };
const adapter = () => new AppWorkspaceOwner(actor.owner, actor.credentials);
const operation = <Id extends (typeof appWorkspaceServerOperations)[number]["handlerRef"]>(id: Id) =>
  appWorkspaceServerOperations.find((op): op is Extract<(typeof appWorkspaceServerOperations)[number], { handlerRef: Id }> => op.handlerRef === id)!;
const values = (values: Record<string, unknown>) => ({ values });

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });

beforeEach(() => {
  vi.resetAllMocks();
  workspace.activeRunId = null;
  mocks.access.mockResolvedValue([app, { entry: { path: "/permissions" } }]);
  mocks.current.mockResolvedValue(null);
  mocks.sessions.mockResolvedValue({ sessions: [{
    id: sessionId, title: "Build", agentId: "builder", latestRun: { id: runId, status: "running" }, updatedAt: now,
  }], nextCursor: null });
  mocks.releases.mockResolvedValue(releases);
  mocks.request.mockImplementation(async (url: string, method = "GET") => {
    if (url.startsWith("/v1/workspaces?")) return { items: url.includes("offset=0") ? [workspace] : [] };
    if (url === path && method === "DELETE") return { sessionIds: [sessionId] };
    if (url === path || url === "/v1/workspaces") return workspace;
    if (url.startsWith(`${path}/tree`)) return tree;
    if (url.startsWith(`${path}/commits`)) {
      const query = new URL(url, "http://runtime").searchParams;
      const offset = Number(query.get("offset"));
      return { items: commits.slice(offset, offset + Number(query.get("limit"))) };
    }
    if (url.startsWith(`${path}/diff`)) return { patch };
    if (url === `${path}/restore`) return { commit: head };
    throw new Error(`Unexpected request ${url}`);
  });
  mocks.bytes.mockResolvedValue(Buffer.from("<main>App</main>"));
  mocks.publish.mockResolvedValue(releases[0]);
  mocks.rollback.mockResolvedValue(releases[1]);
  mocks.put.mockResolvedValue({ text: JSON.stringify({ success: true }) });
});

it("declares the associated session's real type and registers the form saves", () => {
  expect(platformObjectTypes[APP_WORKSPACE].reads?.sessions?.rowType).toBe(AGENT_SESSION);
  expect(platformObjectTypes[AGENT_SESSION]).toBeDefined();
  for (const id of [APP_WORKSPACE_CREATE, APP_WORKSPACE_SAVE, APP_WORKSPACE_PUBLISH])
    expect(isPlatformFormSaveOperation(id)).toBe(true);
});

it("checks app entry before requesting any records and keeps the owned runtime scope", async () => {
  mocks.access.mockRejectedValueOnce(new HttpError(403, "denied", "FORBIDDEN"));
  await expect(adapter().record(id)).rejects.toHaveProperty("status", 403);
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.request.mockRejectedValueOnce(new HttpError(404, "foreign workspace", "NOT_FOUND"));
  await expect(adapter().record(id)).rejects.toHaveProperty("status", 404);
  expect(mocks.client).toHaveBeenCalledWith(actor.owner.domainId, undefined, actor.owner.userId);
  expect(mocks.releases).not.toHaveBeenCalled();
});

it("projects the previews and publication even when build-test status is down", async () => {
  mocks.current.mockRejectedValue(new Error("unavailable"));
  const row = panelRecordSchema.parse(await adapter().record(id));
  expect(row.outputs).toMatchObject({
    hasPanelCandidate: true, candidatePreviewPath: `/app-builder/${id}/panel-preview/working/preview`,
    hasHostedIndex: true, hostedPreviewPath: `/app-builder/${id}/hosted-preview`,
    published: true, publishedAppName: "Inventory", publishedAppPath: app.entry.path,
    canManagePermissions: true, buildTestStatus: "UNAVAILABLE", buildTestCanRestart: false,
  });
  expect(row.fields.currentReleaseId).toBe(releaseId);
});

it("filters owned workspaces and paginates commits without losing the next page", async () => {
  const read = adapter();
  expect(panelRecordQuerySchema.parse(await read.list({ search: "SUP" })).rows[0]).toMatchObject({ primaryKey: id });
  expect(panelRecordQuerySchema.parse(await read.list({ search: "missing" })).rows).toEqual([]);
  const page = panelRecordQuerySchema.parse(await read.commits(id, { offset: 1, limit: 1 }));
  expect(page).toMatchObject({ hasMore: true, rows: [{ fields: { id: previous, parentId: initial, isHead: false, isPublishable: true } }] });
});

it("keeps preview files first, exposes file content, and passes through unified diffs without parsing", async () => {
  const read = adapter();
  expect(panelRecordListSchema.parse(await read.files(id, { commit: head })).map(row => row.primaryKey))
    .toEqual(["panel.json", "panel.html", "index.html", "data.bin", "src/main.js"]);
  expect(panelRecordSchema.parse(await read.file(id, { path: "index.html" })).fields).toMatchObject({ isText: true, language: "html", content: "<main>App</main>" });
  expect(panelRecordSchema.parse(await read.file(id, { path: "data.bin" })).fields).toMatchObject({ isText: false, content: "" });
  expect(panelRecordSchema.parse(await read.diff(id, {})).fields).toMatchObject({ content: patch, isEmpty: false });
  expect(mocks.request).toHaveBeenCalledWith(`${path}/diff?from=${previous}&to=${head}`);
  await read.diff(id, { target: "working" });
  expect(mocks.request).toHaveBeenCalledWith(`${path}/diff?from=${head}&to=working`);
  expect(panelRecordSchema.parse(await read.diff(id, { target: initial })).fields).toMatchObject({ content: "", isEmpty: true });
});

it("returns real session identities, occupation state and a workspace-aware chat link", async () => {
  workspace.activeRunId = runId;
  const [row] = panelRecordListSchema.parse(await adapter().sessions(id));
  expect(row).toMatchObject({ className: AGENT_SESSION, primaryKey: sessionId, fields: { isOccupying: true } });
  const link = new URL(String(row.outputs?.openPath), "http://workbench");
  expect(link.pathname).toBe("/agents/chat");
  expect(Object.fromEntries(link.searchParams)).toEqual({ agentId: "builder", sessionId, page: `/app-builder/workspace?workspace=${id}` });
});

it("creates a workspace through the form and refuses to mutate if app entry was denied", async () => {
  const op = operation(APP_WORKSPACE_CREATE);
  const draft = { kind: "draft" } as const;
  const input = values({ name: "Supply" });
  mocks.access.mockRejectedValueOnce(new HttpError(403, "denied", "FORBIDDEN"));
  await expect(op.execute(host, draft, input)).resolves.toMatchObject({ kind: "refusal", code: "FORBIDDEN" });
  expect(mocks.request).not.toHaveBeenCalled();
  const description = panelFormDescriptionSchema.parse(await adapter().createForm());
  expect(description.fields[0]?.path).toBe("/name");
  await expect(op.execute(host, draft, input)).resolves.toMatchObject({ kind: "success", created: { objectType: APP_WORKSPACE, primaryKey: id } });
  expect(mocks.request).toHaveBeenCalledWith("/v1/workspaces", "POST", { name: "Supply" });
  await operation(APP_WORKSPACE_SAVE).execute(host, target, values({ name: "Renamed" }));
  expect(mocks.request).toHaveBeenCalledWith(path, "PATCH", { name: "Renamed" });
});

it("counts sessions for deletion and refuses a busy workspace before stopping tests", async () => {
  const op = operation(APP_WORKSPACE_DELETE);
  const calls = [{ target, input: {} }];
  expect(await op.inspectImpact.inspect(host, calls)).toMatchObject({ total: 2 });
  workspace.activeRunId = runId;
  expect(await op.unavailable(host, target)).toHaveProperty("reason");
  await expect(op.execute(host, target)).resolves.toMatchObject({ kind: "refusal", code: "WORKSPACE_BUSY" });
  expect(mocks.stop).not.toHaveBeenCalled();
  workspace.activeRunId = null;
  await expect(op.execute(host, target)).resolves.toMatchObject({ affected: { removed: [{ primaryKey: id }] } });
  expect(mocks.stop).toHaveBeenCalled();
  expect(mocks.deleteSession).toHaveBeenCalledWith(sessionId, actor.owner);
});

it("requires confirmation for restore, skips HEAD, and restarts only the recorded expired sample", async () => {
  const restore = operation(APP_WORKSPACE_RESTORE_COMMIT);
  expect(await restore.unavailableForInput(host, target, { commit: head })).toHaveProperty("reason");
  await expect(restore.execute(host, target, { commit: head })).resolves.toMatchObject({ kind: "refusal", code: "CURRENT_COMMIT" });
  expect(await restore.inspectImpact!.inspect(host, [{ target, input: { commit: previous } }])).toMatchObject({ total: 1 });
  await restore.execute(host, target, { commit: previous });
  expect(mocks.request).toHaveBeenCalledWith(`${path}/restore`, "POST", { commit: previous });
  const restart = operation(APP_WORKSPACE_RESTART_BUILD_TEST);
  await expect(restart.execute(host, target)).resolves.toMatchObject({ kind: "refusal", code: "BUILD_TEST_RESTART_UNAVAILABLE" });
  expect(mocks.start).not.toHaveBeenCalled();
  mocks.current.mockResolvedValue({ status: "EXPIRED", sampleSummary: { name: "test-data/cases.json" } });
  await restart.execute(host, target);
  expect(mocks.start).toHaveBeenCalledWith("test-data/cases.json");
});

it("supports first and subsequent publication and keeps the active release out of rollback", async () => {
  const read = adapter();
  const publish = operation(APP_WORKSPACE_PUBLISH);
  mocks.releases.mockResolvedValueOnce([]);
  const initialForm = panelFormDescriptionSchema.parse(await read.publishForm(id));
  expect(initialForm.fields).toContainEqual(expect.objectContaining({ path: "/name" }));
  mocks.releases.mockResolvedValueOnce([]);
  await publish.execute(host, target, values({ name: "New app", icon: "folder", commit: head }));
  expect(mocks.publish).toHaveBeenLastCalledWith(actor.owner, id, head, expect.objectContaining({ names: { en: "New app" }, icon: "folder" }), actor.credentials);
  const existingForm = panelFormDescriptionSchema.parse(await read.publishForm(id));
  expect(existingForm.fields).not.toContainEqual(expect.objectContaining({ path: "/name" }));
  expect(existingForm.fields).toContainEqual(expect.objectContaining({ path: "/icon", control: { kind: "application-icon" } }));
  await expect(publish.execute(host, target, values({ icon: "folder", commit: head }))).resolves.toMatchObject({ kind: "refusal", code: "COMMIT_NOT_PUBLISHABLE" });
  await expect(publish.execute(host, target, values({ icon: "microscope", commit: previous }))).resolves.toMatchObject({
    affected: { objectTypes: [APP_WORKSPACE, APPLICATION] },
  });
  expect(mocks.publish).toHaveBeenLastCalledWith(actor.owner, id, previous, expect.objectContaining({ names: app.names, descriptions: app.descriptions, icon: "microscope" }), actor.credentials);
  const rows = panelRecordListSchema.parse(await read.releases(id));
  expect(rows.find(row => row.primaryKey === releaseId)?.fields.isCurrent).toBe(true);
  const rollback = operation(APP_WORKSPACE_ROLLBACK_RELEASE);
  expect(await rollback.unavailableForInput(host, target, { releaseId })).toHaveProperty("reason");
  await expect(rollback.execute(host, target, { releaseId })).resolves.toMatchObject({ kind: "refusal", code: "CURRENT_RELEASE" });
  expect(await rollback.inspectImpact!.inspect(host, [{ target, input: { releaseId: oldReleaseId } }])).toHaveProperty("total", 1);
  await rollback.execute(host, target, { releaseId: oldReleaseId });
  expect(mocks.rollback).toHaveBeenCalledWith(actor.owner, id, oldReleaseId, expect.objectContaining({ names: app.names }), actor.credentials);
  await operation(APP_WORKSPACE_UPDATE_PUBLISHED_ICON).execute(host, target, { icon: "microscope" });
  expect(mocks.put).toHaveBeenCalledWith(expect.any(String), "/platform/applications/app-stock/icon", { icon: "microscope" }, actor.credentials);
});

it("can publish a new version while keeping an icon that has since left the palette", async () => {
  mocks.access.mockResolvedValue([{ ...app, icon: "older-catalog-icon" }]);
  const publish = operation(APP_WORKSPACE_PUBLISH);
  await expect(publish.execute(host, target, values({ icon: "older-catalog-icon", commit: previous }))).resolves.toMatchObject({ kind: "success" });
  expect(mocks.publish).toHaveBeenLastCalledWith(actor.owner, id, previous, expect.objectContaining({ icon: "older-catalog-icon" }), actor.credentials);
});
