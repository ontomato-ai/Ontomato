import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceFile } from "@ontomato/contracts/workspaces";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { panelRecordSchema } from "@ontomato/contracts/panel-projection";
import type { ProductPanelInput, ProductProjectionInput } from "@ontomato/contracts/product-panels";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { findCurrentProduct, findCurrentProducts, type CurrentProductRow } from "../../../infrastructure/product-current";
import { backendDelete, backendGet, backendPut } from "../../../utils/backend-client";
import { HttpError } from "../../../utils/errors";
import { assistantService } from "../../assistant/service";
import { saveCurrentPanel, saveCurrentProjection } from "../../product-panels/current";
import { panelServerOperation, registeredPanelOperation, type PanelOperationHost } from "../../product-panels/server-operations";
import { ApplicationBuilderReadAdapter } from "../application-panel-reads";
import { applicationBuilderServerOperations } from "../application-panel-operations";
import { appBuilderProjectStore, type AppBuilderProjectRow, type AppBuilderReleaseRow, type OwnedResourceKind } from "../project-store";
import {
  createDraftProject, deleteApplicationBuilderDraft, ensureMaterializedWorkspace, getBuilderProject, listBuilderProjects,
  publishApplicationBuilderSource, readApplicationSourceFiles, rollbackApplicationBuilderRelease, syncApplicationBuilderSource,
  updateDraftProjectMeta,
} from "../project-service";
import { decodeFileText, parseApplicationSource, type ApplicationSourceManifest } from "../source-codec";

vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) }),
}));
vi.mock("../access", () => ({ assertAppBuilderAccess: async () => {} }));
vi.mock("../../../utils/backend-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../../utils/backend-client")>(),
  backendGet: vi.fn(), backendPut: vi.fn(), backendDelete: vi.fn(),
}));
vi.mock("../../../infrastructure/product-current", async importOriginal => ({
  ...await importOriginal<typeof import("../../../infrastructure/product-current")>(),
  findCurrentProduct: vi.fn(), findCurrentProducts: vi.fn(),
}));
vi.mock("../../product-panels/current", async importOriginal => ({
  ...await importOriginal<typeof import("../../product-panels/current")>(),
  saveCurrentPanel: vi.fn(), saveCurrentProjection: vi.fn(),
}));
vi.mock("../../assistant/service", () => ({ assistantService: { deleteWorkspaceSessions: vi.fn() } }));

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });

const owner = { domainId: "school", userId: "alice" };
const other = { ...owner, userId: "bob" };
const credentials = { locale: "en", token: "alice" };
const partner = { ...credentials, token: "bob" };
const outsider = { ...credentials, token: "visitor" };
const date = new Date("2026-11-25T00:00:00Z");
const panelId = "shared-panel";
const projectionId = "shared-projection";
const panelPath = `panels/${panelId}/panel.html`;
const originalPanel: ProductPanelInput = {
  name: "Inventory", description: "Panel description", visibility: "domain",
  manifest: { components: {}, state: {}, members: { summary: { target: { projectionId } } } },
  content: {
    html: "<section>Base</section>\n", module: "export default () => {};",
    recipes: "# Inventory", style: ".item { display: block; }",
    messages: { en: { "panel.name": "Inventory" }, "zh-CN": { "panel.name": "库存" } },
  },
  theme: { dark: { "--color-text-primary": "#eee" } },
};
const projection: ProductProjectionInput = {
  name: "Summary", description: "Records", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
  inputs: {}, outputs: {}, config: {}, data: {}, operations: {},
};
function application(appId: string): ApplicationSourceManifest {
  return {
    declaration: {
      names: { en: "Inventory", "zh-CN": "库存" },
      descriptions: { en: "Track supplies", "zh-CN": "跟踪物料" },
      icon: "builder",
      groups: [{ key: "main", names: { en: "Main" }, sort: 0 }],
    },
    entry: { path: `/applications/${appId}`, renderer: "panels" },
    initialOpenEntryIds: [], allowStandalone: false,
    framePanelId: "builtin-product-platform-frame",
    theme: { light: { "--color-text-primary": "#223344" }, dark: { "--color-text-primary": "#eee" } },
    panelUses: [{
      id: "main", pageKey: "inventory", path: `/applications/${appId}/main`, panelId,
      groupKey: "main", pageComposer: "none",
      inputs: { account: { literal: "school" } }, defaultAgent: { kind: "preset", agentKind: "app-builder" },
      icon: "builder", names: { en: "Inventory", "zh-CN": "库存" },
      descriptions: { en: "Stock", "zh-CN": "存货" },
    }],
    delivery: { panels: [panelId], projections: [projectionId], agents: [], skills: [], packages: [] },
  };
}
const apps = new Map<string, ApplicationSourceManifest>();
const projects = new Map<string, AppBuilderProjectRow>();
const claims = { panel: new Map<string, string>(), projection: new Map<string, string>() };
const current = { panel: new Map<string, CurrentProductRow>(), projection: new Map<string, CurrentProductRow>() };
const workspaces = new Map<string, { slot: string; name: string; commits: Map<string, WorkspaceFile[]>; head: string; working: WorkspaceFile[] }>();
const releases: AppBuilderReleaseRow[] = [];
const timeline: string[] = [];
let commitSequence = 0;
const nextCommit = () => (++commitSequence).toString(16).padStart(40, "0");
const answer = (body: unknown) => ({ text: JSON.stringify(body), status: 200, statusText: "OK", headers: new Headers() });

function setResource(kind: OwnedResourceKind, id: string, definition: Record<string, unknown>) {
  current[kind].set(id, {
    id, definition, domainId: owner.domainId, ownerId: owner.userId,
    revision: (current[kind].get(id)?.revision ?? 0) + 1, createdAt: date, updatedAt: date,
  });
}

const request = vi.fn(async function (
  this: RuntimeClient, resource: string, method?: string, input?: unknown,
) {
  const body = input as { name?: string; commit?: string; files?: WorkspaceFile[]; baseline?: WorkspaceFile[] } | undefined;
  const url = new URL(resource, "http://runtime.test");
  const [, , , existingId, action] = url.pathname.split("/");
  const id = existingId ?? randomUUID();
  if (!existingId && method === "POST") {
    const head = nextCommit();
    workspaces.set(id, { slot: this.workspaceOwnerId!, name: body!.name!, head, commits: new Map([[head, []]]), working: [] });
  }
  const ws = workspaces.get(id);
  if (!ws || ws.slot !== this.workspaceOwnerId) throw new HttpError(404, "Workspace not found", "NOT_FOUND");
  if (method === "DELETE") {
    timeline.push("workspace");
    workspaces.delete(id);
    return { sessionIds: [] };
  }
  if (action === "import") {
    let baselineCommit: string | undefined;
    if (body!.baseline) {
      baselineCommit = nextCommit();
      ws.commits.set(baselineCommit, body!.baseline);
    }
    ws.head = nextCommit();
    ws.working = body!.files!;
    ws.commits.set(ws.head, ws.working);
    return { commit: ws.head, baselineCommit };
  }
  const ref = body?.commit ?? url.searchParams.get("commit");
  const files = ref ? ws.commits.get(ref) : ws.working;
  if (!files) throw new Error("Unexpected commit");
  if (action === "export") return { commit: ref, files };
  if (action === "tree") return { files: files.map(file => ({ path: file.path, size: file.content.length })) };
  return { id, name: ws.name, headCommit: ws.head, activeRunId: null, createdAt: date.toISOString(), updatedAt: date.toISOString() };
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const map of [apps, projects, claims.panel, claims.projection, current.panel, current.projection, workspaces]) map.clear();
  timeline.length = 0;
  releases.length = 0;
  commitSequence = 0;
  setResource("panel", panelId, originalPanel);
  setResource("projection", projectionId, projection);
  vi.spyOn(appBuilderProjectStore, "findByAppId").mockImplementation(async (_domain, id) => projects.get(id) ?? null);
  vi.spyOn(appBuilderProjectStore, "listByAppIds").mockImplementation(async (_domain, ids) =>
    new Map([...projects].filter(([id]) => ids.includes(id))));
  vi.spyOn(appBuilderProjectStore, "listDraftsByCreator").mockImplementation(async (_domain, creator) =>
    [...projects.values()].filter(row => row.createdBy === creator && row.draftMeta !== null));
  vi.spyOn(appBuilderProjectStore, "insertProject").mockImplementation(async row => {
    const project = { lastSyncedCommit: null, lastSyncedFingerprint: null, ...row, createdAt: date.toISOString(), updatedAt: date.toISOString() };
    projects.set(row.appId, project);
    return project;
  });
  vi.spyOn(appBuilderProjectStore, "markSynced").mockImplementation(async (_domain, id, fingerprint, commit, clearDraft) => {
    const project = projects.get(id)!;
    project.lastSyncedCommit = commit;
    project.lastSyncedFingerprint = fingerprint;
    if (clearDraft) project.draftMeta = null;
    return project;
  });
  vi.spyOn(appBuilderProjectStore, "findResourceOwners").mockImplementation(async (_domain, kind, ids) =>
    new Map([...claims[kind]].filter(([id]) => ids.includes(id))));
  vi.spyOn(appBuilderProjectStore, "claimUnclaimedResources").mockImplementation(async (_domain, appId, resources) => {
    const result = { panels: new Map<string, string>(), projections: new Map<string, string>() };
    for (const { kind, resourceId } of resources) {
      if (!claims[kind].has(resourceId)) claims[kind].set(resourceId, appId);
      result[kind === "panel" ? "panels" : "projections"].set(resourceId, claims[kind].get(resourceId)!);
    }
    return result;
  });
  vi.spyOn(appBuilderProjectStore, "deleteProject").mockImplementation(async (_domain, id) => {
    timeline.push("project");
    projects.delete(id);
    for (const map of Object.values(claims)) {
      for (const [resource, appId] of map) if (id === appId) map.delete(resource);
    }
  });
  vi.spyOn(appBuilderProjectStore, "recordRelease").mockImplementation(async input => {
    const release = { id: randomUUID(), createdAt: date.toISOString(), ...input };
    releases.push(release);
    return release;
  });
  vi.spyOn(appBuilderProjectStore, "listReleases").mockImplementation(async (_domain, id) => releases.filter(r => r.appId === id));
  vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(request);
  vi.spyOn(RuntimeClient.prototype, "bytes").mockImplementation(async function (this: RuntimeClient, resource) {
    const url = new URL(resource, "http://runtime.test");
    const workspace = workspaces.get(url.pathname.split("/")[3])!;
    expect(workspace.slot).toBe(this.workspaceOwnerId);
    const ref = url.searchParams.get("commit");
    const file = (ref ? workspace.commits.get(ref)! : workspace.working).find(item => item.path === url.searchParams.get("path"))!;
    return Buffer.from(file.content, file.encoding);
  });
  vi.mocked(findCurrentProduct).mockImplementation(async (_domain, kind, id) => current[kind].get(id));
  vi.mocked(findCurrentProducts).mockImplementation(async (_domain, kind, ids) =>
    new Map([...current[kind]].filter(([id]) => ids.includes(id))));
  vi.mocked(saveCurrentPanel).mockImplementation(async (_owner, _credentials, id, input) => {
    setResource("panel", id, input);
    throw new Error("Unexpected panel save");
  });
  vi.mocked(saveCurrentProjection).mockRejectedValue(new Error("Unexpected projection save"));
  vi.mocked(assistantService.deleteWorkspaceSessions).mockImplementation(async () => { timeline.push("sessions"); });
  vi.mocked(backendGet).mockImplementation(async (_operation, raw, options) => {
    const { pathname, searchParams } = new URL(raw, "http://java.test");
    const id = pathname.split("/").at(-1)!;
    const summary = (appId: string, app: ApplicationSourceManifest) => ({
      id: appId, source: "domain", canMaintain: options?.headers?.tk !== "visitor",
      canEditEntries: app.entry.renderer === "panels" && appId !== "app-connected",
      entryCount: app.panelUses.length, names: app.declaration.names, descriptions: app.declaration.descriptions, icon: app.declaration.icon,
    });
    if (id === "catalogue") return answer({ success: true, data: { rows: [...apps].map(([id, app]) => summary(id, app)) } });
    if (id === "applications") return answer({ success: true, data: [] });
    if (id === "panel-uses") {
      expect(searchParams.get("purpose")).toBe("management");
      const appId = pathname.split("/").at(-2)!;
      const { initialOpenEntryIds: _opening, ...app } = apps.get(appId)!;
      return answer({ success: true, data: { applicationId: appId, ...app } });
    }
    const app = apps.get(id);
    if (!app) throw new HttpError(404, "No application", "NOT_FOUND");
    return answer({ success: true, data: { ...summary(id, app), groups: app.declaration.groups, entry: app.entry, panelUses: app.panelUses } });
  });
  vi.mocked(backendPut).mockImplementation(async (_operation, raw, values) => {
    const id = new URL(raw, "http://java.test").pathname.split("/").at(-2)!;
    apps.set(id, values as ApplicationSourceManifest);
    return answer({ success: true });
  });
  vi.mocked(backendDelete).mockImplementation(async (_operation, raw) => {
    timeline.push("application");
    apps.delete(new URL(raw, "http://java.test").pathname.split("/").at(-1)!);
    return answer(null);
  });
});

function published(id: string) {
  const app = application(id);
  apps.set(id, app);
  return app;
}
function editWorkingPanel(project: AppBuilderProjectRow, html: string) {
  const workspace = workspaces.get(project.workspaceId)!;
  workspace.working = workspace.working.map(file => file.path === panelPath ? { ...file, encoding: "utf8", content: html } : file);
}
function readWorkingPanel(project: AppBuilderProjectRow) {
  return decodeFileText(workspaces.get(project.workspaceId)!.working.find(file => file.path === panelPath)!);
}
async function deletePublished(id: string) {
  const actor = { owner, credentials };
  const unused = async () => { throw new Error("Unexpected request"); };
  const host: PanelOperationHost = { initiator: actor, executor: actor, requestWorkbench: unused, request: unused };
  const operation = panelServerOperation("applications.delete");
  if (operation.effect !== "write" || operation.kind !== "action" || operation.targetInput === undefined) throw new Error("Expected a write operation");
  return operation.execute(host, { kind: "object", objectType: APPLICATION, primaryKey: id }, {}, randomUUID());
}

it("claims the shared panel and projection once and keeps a referencing application's release independent", async () => {
  published("app-first");
  published("app-second");
  await ensureMaterializedWorkspace(owner, credentials, "app-first");
  const second = await ensureMaterializedWorkspace(owner, credentials, "app-second");
  expect(claims.panel.get(panelId)).toBe("app-first");
  expect(claims.projection.get(projectionId)).toBe("app-first");
  expect((await readApplicationSourceFiles(owner, credentials, "app-second")).map(file => file.path)).toEqual(["application.json"]);
  expect(second.lastSyncedFingerprint).toMatchObject({ panels: {}, projections: {} });

  const changed = { ...originalPanel, content: { ...originalPanel.content, html: "<section>Live edit</section>" } };
  setResource("panel", panelId, changed);
  setResource("projection", projectionId, { ...projection, name: "Live projection edit" });
  await publishApplicationBuilderSource(owner, credentials, "app-second", { commit: second.lastSyncedCommit! });
  expect(saveCurrentPanel).not.toHaveBeenCalled();
  expect(saveCurrentProjection).not.toHaveBeenCalled();
  expect(current.panel.get(panelId)?.definition).toEqual(changed);

  expect(await deletePublished("app-first")).toMatchObject({ kind: "success" });
  expect(claims.panel.has(panelId)).toBe(false);
  expect(claims.projection.has(projectionId)).toBe(false);
});

it("lists without snapshots or source files and gates detail, publish and rollback on owned drift", async () => {
  published("app-drift");
  const project = await ensureMaterializedWorkspace(owner, credentials, "app-drift");
  const release = await publishApplicationBuilderSource(owner, credentials, "app-drift", { commit: project.lastSyncedCommit! });
  setResource("panel", panelId, { ...originalPanel, name: "Live edit" });
  vi.mocked(backendGet).mockClear();
  vi.mocked(findCurrentProducts).mockClear();
  request.mockClear();
  const list = await new ApplicationBuilderReadAdapter(owner, credentials).builderProjects({});
  expect(list[0].fields).not.toHaveProperty("hasDrift");
  expect(backendGet).not.toHaveBeenCalledWith("app-builder-panel-uses", expect.anything(), expect.anything());
  expect(findCurrentProducts).not.toHaveBeenCalled();
  expect(request.mock.calls.every(([url]) => /^\/v1\/workspaces\/[^/]+$/.test(url))).toBe(true);
  const detail = panelRecordSchema.parse(await new ApplicationBuilderReadAdapter(owner, credentials).builderProject("app-drift"));
  expect(detail.outputs?.hasDrift).toBe(true);
  expect(detail.fields.driftItems).toMatchObject({ kind: "json", value: [{ kind: "panel", id: panelId, status: "modified" }] });
  const files = await new ApplicationBuilderReadAdapter(owner, credentials).sourceFiles("app-drift", {});
  const nestedHtml = files.find(file => file.primaryKey === panelPath);
  expect(nestedHtml).toMatchObject({
    primaryKey: panelPath,
    label: "panel.html",
    fields: { path: panelPath },
  });
  await expect(publishApplicationBuilderSource(owner, credentials, "app-drift", { commit: release.commit }))
    .rejects.toMatchObject({ code: "APPLICATION_SOURCE_DRIFT", status: 409 });
  await expect(rollbackApplicationBuilderRelease(owner, credentials, "app-drift", release.releaseId))
    .rejects.toMatchObject({ code: "APPLICATION_SOURCE_DRIFT", status: 409 });
});

it("publishes a derived source with identical application payload, panel, projection and fingerprint", async () => {
  const original = published("app-roundtrip");
  const context = await ensureMaterializedWorkspace(owner, credentials, "app-roundtrip");
  const baseline = context.lastSyncedFingerprint;
  const parsed = parseApplicationSource(workspaces.get(context.workspaceId)!.working);
  const { initialOpenEntryIds: _opening, ...storedApplication } = original;
  expect(parsed).toEqual({
    kind: "panel-app", application: storedApplication,
    panels: [{ id: panelId, input: originalPanel }], projections: [{ id: projectionId, input: projection }],
  });
  await publishApplicationBuilderSource(owner, credentials, "app-roundtrip", { commit: context.lastSyncedCommit! });
  expect(backendPut).toHaveBeenCalledWith("application-catalogue-publish-source", expect.stringContaining("/panel-uses"), storedApplication, expect.anything());
  expect(apps.get("app-roundtrip")).toEqual(storedApplication);
  expect(context.lastSyncedFingerprint).toEqual(baseline);
  expect(saveCurrentPanel).not.toHaveBeenCalled();
  expect(saveCurrentProjection).not.toHaveBeenCalled();
});

it("preserves both sides through repeated synchronization and writes explicit overlapping conflicts", async () => {
  const app = published("app-sync");
  const project = await ensureMaterializedWorkspace(owner, credentials, "app-sync");
  editWorkingPanel(project, "<section>Unpublished</section>\n");
  app.declaration.names.en = "Renamed outside Builder";
  const merged = await syncApplicationBuilderSource(owner, credentials, "app-sync");
  expect(merged).toMatchObject({ hasConflicts: false, conflictFiles: [], mergedPaths: ["application.json"] });
  expect(readWorkingPanel(project)).toContain("Unpublished");
  expect(parseApplicationSource(workspaces.get(project.workspaceId)!.working)).toMatchObject({
    application: { declaration: { names: { en: "Renamed outside Builder" } } },
  });
  await syncApplicationBuilderSource(owner, credentials, "app-sync");
  expect(readWorkingPanel(project)).toContain("Unpublished");

  setResource("panel", panelId, { ...originalPanel, content: { ...originalPanel.content, html: "<section>Live</section>\n" } });
  const conflict = await syncApplicationBuilderSource(owner, credentials, "app-sync");
  expect(conflict).toMatchObject({ hasConflicts: true, conflictFiles: [panelPath] });
  expect(readWorkingPanel(project)).toMatch(/<<<<<<<[^\n]*\n<section>Unpublished<\/section>\n=======\n<section>Live<\/section>\n>>>>>>>/);
  await expect(publishApplicationBuilderSource(owner, credentials, "app-sync", { commit: conflict.commit }))
    .rejects.toMatchObject({ code: "SOURCE_MERGE_CONFLICTS" });
});

it("keeps drafts private and shares published source only with maintainers, excluding connected apps", async () => {
  const draft = await createDraftProject(owner, credentials, { name: "Private draft" });
  expect(backendPut).not.toHaveBeenCalled();
  expect(apps.has(draft.appId)).toBe(false);
  expect((await listBuilderProjects(owner, credentials)).map(item => item.appId)).toContain(draft.appId);
  expect((await listBuilderProjects(other, partner)).map(item => item.appId)).not.toContain(draft.appId);
  await expect(getBuilderProject(other, partner, draft.appId)).rejects.toHaveProperty("status", 404);
  await expect(readApplicationSourceFiles(other, partner, draft.appId)).rejects.toHaveProperty("status", 404);
  await expect(updateDraftProjectMeta(other, partner, draft.appId, { name: "Changed" })).rejects.toHaveProperty("status", 404);

  const connected = published("app-connected");
  connected.entry.path = "/__external/app-connected";
  published("app-maintained");
  const source = await ensureMaterializedWorkspace(owner, credentials, "app-maintained");
  await expect(ensureMaterializedWorkspace(other, partner, "app-maintained")).resolves.toMatchObject({ workspaceId: source.workspaceId });
  await expect(ensureMaterializedWorkspace(other, outsider, "app-maintained")).rejects.toHaveProperty("status", 403);
  await expect(syncApplicationBuilderSource(other, partner, "app-maintained")).resolves.toMatchObject({ hasConflicts: false });
  expect((await listBuilderProjects(other, partner)).map(item => item.appId)).toEqual(["app-maintained"]);
});

it("deletes a draft directly and a published app through catalogue deletion before cleaning shared artifacts", async () => {
  const draft = await createDraftProject(owner, credentials, { name: "Private draft" });
  await deleteApplicationBuilderDraft(owner, credentials, draft.appId);
  expect(timeline).toEqual(["workspace", "sessions", "project"]);
  expect(projects.has(draft.appId)).toBe(false);
  expect(workspaces.has(draft.workspaceId)).toBe(false);
  timeline.length = 0;

  published("app-delete");
  const project = await ensureMaterializedWorkspace(owner, credentials, "app-delete");
  await expect(deleteApplicationBuilderDraft(owner, credentials, "app-delete"))
    .rejects.toMatchObject({ status: 409, code: "APPLICATION_PUBLISHED" });
  expect(timeline).toEqual([]);
  expect(await deletePublished("app-delete")).toMatchObject({ kind: "success" });
  expect(timeline).toEqual(["application", "workspace", "sessions", "project"]);
  expect(assistantService.deleteWorkspaceSessions).toHaveBeenLastCalledWith(owner.domainId, project.workspaceId);
  expect(projects.has("app-delete")).toBe(false);
  expect(workspaces.has(project.workspaceId)).toBe(false);
});

it("registers every builder write on the application type so the action directory can describe it", () => {
  for (const { handlerRef } of applicationBuilderServerOperations) {
    expect(registeredPanelOperation(handlerRef)).toMatchObject({
      targetType: APPLICATION,
      handler: { handlerRef, binding: { kind: "PlatformOperation", id: handlerRef } },
    });
  }
});
