import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { domainApplicationIconSchema, recommendApplicationIcon } from "@ontomato/contracts/application-icons";
import { applicationCatalogueQueryResultSchema } from "@ontomato/contracts/application-catalogue";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { buildTestContextSchema } from "@ontomato/contracts/build-tests";
import {
  isApplicationPanelUse, isBuiltinProductId, METRIC_CHART_COMPONENT,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import {
  workspaceCommitSchema, workspaceExportSchema, workspaceSchema,
  type Workspace, type WorkspaceCommit, type WorkspaceCommitPage,
  type WorkspaceDiff, type WorkspaceFile, type WorkspaceTree,
} from "@ontomato/contracts/workspaces";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import { supportedLocales, resolveLocale } from "../../i18n";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { transaction } from "../../infrastructure/postgres-transaction";
import { findCurrentProduct } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { JavaPanelRead, JavaPanelReadResult } from "../product-panels/java-panel-reads";
import type { AssistantOwner } from "../assistant/store";
import { applicationCatalogueClient } from "../product-panels/application-catalogue";
import { saveCurrentPanel, saveCurrentProjection } from "../product-panels/current";
import { assertAppBuilderAccess } from "./access";
import { closeWorkspaceBuildTests, WorkspaceBuildTests } from "./build-tests";
import { readAdmittedLiveApplicationSnapshot, readLiveApplicationSnapshot, type LiveSnapshotResult } from "./live-snapshot";
import {
  appBuilderProjectStore, appWorkspaceSlot, draftApplicationMetaSchema,
  type AppBuilderProjectRow, type AppBuilderReleaseRow, type DraftApplicationMeta, type OwnedResourceRef,
} from "./project-store";
import {
  APPLICATION_SOURCE_FILE, computeLiveFingerprint, decodeFileText, detectConflictMarkers,
  diffFingerprints, parseApplicationSource, serializeApplicationSource, sha256Canonical,
  type ApplicationLiveFingerprint, type ApplicationSourceManifest, type DriftReport,
} from "./source-codec";
import { threeWayMergeFiles } from "./three-way-merge";

const PREFERRED_FILES = [APPLICATION_SOURCE_FILE, "panel.json", "panel.html"];
const PAGE_SIZE = 100;

export interface BuilderProjectSummary {
  appId: string;
  name: string;
  names: Record<string, string>;
  descriptions: Record<string, string>;
  icon: string;
  published: boolean;
  workspaceId: string | null;
  busy: boolean;
  activeRunId: string | null;
  updatedAt: string;
  canEditEntries: boolean;
}

export interface BuilderPreviewEntry {
  id: string;
  panelId: string;
  label: string;
  path: string;
}

const builderTestStatusSchema = buildTestContextSchema.pick({ status: true, expiresAt: true }).extend({
  sampleSummary: buildTestContextSchema.shape.sampleSummary.pick({ name: true }),
});
export type BuilderTestStatus = z.infer<typeof builderTestStatusSchema>;

export interface BuilderProjectDetail extends BuilderProjectSummary {
  sourceKind: "panel" | "empty";
  materialized: boolean;
  headCommit: string | null;
  openPath: string | null;
  managePath: string | null;
  drift: DriftReport;
  conflictFiles: string[];
  hasConflicts: boolean;
  test: BuilderTestStatus | null;
  previewEntries: BuilderPreviewEntry[];
  foreignPanelIds: string[];
  foreignProjectionIds: string[];
  currentReleaseId: string | null;
}

export function builderPublishBlock(detail: BuilderProjectDetail) {
  if (detail.busy) return "busy";
  if (!detail.materialized) return "notMaterialized";
  if (detail.drift.hasDrift) return "driftBlocking";
  if (detail.hasConflicts) return "conflictsBlocking";
}

export function canRestartBuilderTest(test: BuilderTestStatus | null) {
  return test !== null && (test.status === "EXPIRED" || test.status === "CLOSED") && Boolean(test.sampleSummary.name);
}

export interface AuthorizedProjectContext {
  appId: string;
  published: boolean;
  project: AppBuilderProjectRow | null;
  live: LiveSnapshotResult | null;
  metadata: DraftApplicationMeta;
  runtime: RuntimeClient;
}

export function appRuntimeClient(owner: AssistantOwner, appId: string): RuntimeClient {
  return new RuntimeClient(owner.domainId, undefined, owner.userId, appWorkspaceSlot(appId));
}

function localizedNameOf(names: Record<string, string>, locale: string | undefined, fallback: string): string {
  return localizedApplicationText(names, resolveLocale(locale)) ?? fallback;
}

function defaultLocalizedMap(name: string): Record<string, string> {
  return Object.fromEntries(supportedLocales().map(locale => [locale, name]));
}

function filesAreCanonicalEqual(a: unknown, b: unknown): boolean {
  return sha256Canonical(a) === sha256Canonical(b);
}

function draftMetadata(owner: AssistantOwner, project: AppBuilderProjectRow | null) {
  if (!project?.draftMeta) return;
  if (project.createdBy !== owner.userId) throw new HttpError(404, "Application project not found", "NOT_FOUND");
  return project.draftMeta;
}

/**
 * Authorizes access to an application project:
 * - Published domain application: caller must satisfy Java `canMaintain === true` (excludes `builtin` & `connected`).
 * - Unpublished draft: must exist in `app_builder_projects` with `draft_meta IS NOT NULL` AND `created_by === owner.userId`.
 */
export async function authorizeBuilderProject(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  options: { skipLiveRead?: boolean } = {},
): Promise<AuthorizedProjectContext> {
  const project = await appBuilderProjectStore.findByAppId(owner.domainId, appId);
  const runtime = appRuntimeClient(owner, appId);

  const draft = draftMetadata(owner, project);
  if (draft) return { appId, published: false, project, live: null, metadata: draft, runtime };

  if (options.skipLiveRead) {
    const detail = await applicationCatalogueClient(credentials).record(appId);
    if (detail.source === "builtin" || !detail.canEditEntries) {
      throw new HttpError(403, "Application cannot be edited in App Builder", "FORBIDDEN");
    }
    if (!detail.canMaintain) {
      throw new HttpError(403, "Application edit permission required", "PRODUCT_FORBIDDEN");
    }
    return { appId, published: true, project, live: null, metadata: detail, runtime };
  }

  let live: LiveSnapshotResult;
  try {
    live = await readLiveApplicationSnapshot(owner.domainId, appId, credentials, { ownedOnly: project !== null });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(404, "Application project not found", "NOT_FOUND");
    }
    throw error;
  }
  if (!live.applicationMeta.canMaintain) {
    throw new HttpError(403, "Application edit permission required", "PRODUCT_FORBIDDEN");
  }
  const metadata = live.snapshot.application.declaration;
  return { appId, published: true, project, live, metadata, runtime };
}

async function locateBuilderProject(owner: AssistantOwner, appId: string) {
  const project = await appBuilderProjectStore.findByAppId(owner.domainId, appId);
  return { project, draft: draftMetadata(owner, project) };
}

function builderProjectContext(
  owner: AssistantOwner, appId: string, project: AppBuilderProjectRow | null, draft: DraftApplicationMeta | undefined,
  metadata: DraftApplicationMeta, live: LiveSnapshotResult | null = null,
): AuthorizedProjectContext {
  return { appId, project, live, published: draft === undefined, metadata, runtime: appRuntimeClient(owner, appId) };
}

/** The project row locates the owner; published authority comes from the same Java read item. */
export async function prepareBuilderProjectMetadataRead(owner: AssistantOwner, appId: string) {
  const { project, draft } = await locateBuilderProject(owner, appId);
  return {
    call: draft ? undefined : { type: APPLICATION, name: "builderProjectMetadata", parameters: { primaryKey: appId } },
    present(payload: unknown): AuthorizedProjectContext {
      return builderProjectContext(owner, appId, project, draft, draft ?? draftApplicationMetaSchema.parse(payload));
    },
  };
}

export function builderFactPayload(result: JavaPanelReadResult) {
  if (result.status === "ready") return result.payload;
  if (result.status === "forbidden") throw new HttpError(403, result.error, result.code ?? undefined);
  if (result.status === "error") throw new HttpError(502, result.error, result.code ?? undefined);
  throw new HttpError(404, "Application project not found", "NOT_FOUND");
}

export async function prepareBuilderProjectFacts(
  owner: AssistantOwner, appId: string, { live, status }: { live: boolean; status: boolean },
) {
  const { project, draft } = await locateBuilderProject(owner, appId);
  const facts: { call: NonNullable<JavaPanelRead["call"]> }[] = [];
  const catalogueIndex = draft ? undefined : facts.push({
    call: { type: APPLICATION, name: live ? "record" : "builderProjectMetadata", parameters: { primaryKey: appId } },
  }) - 1;
  const statusIndex = status && project ? facts.push({
    call: { type: APPLICATION, name: "builderTestStatus", parameters: { workspaceId: project.workspaceId } },
  }) - 1 : undefined;

  return {
    facts, catalogueIndex, statusIndex,
    async context(results: readonly JavaPanelReadResult[]) {
      if (draft) return builderProjectContext(owner, appId, project, draft, draft);
      const payload = builderFactPayload(results[catalogueIndex!]);
      if (!live) return builderProjectContext(owner, appId, project, draft, draftApplicationMetaSchema.parse(payload));
      const snapshot = await readAdmittedLiveApplicationSnapshot(owner.domainId, appId, payload, project !== null);
      return builderProjectContext(owner, appId, project, draft, snapshot.snapshot.application.declaration, snapshot);
    },
    test(results: readonly JavaPanelReadResult[]): BuilderTestStatus | null {
      if (statusIndex === undefined || results[statusIndex].status === "empty") return null;
      return builderTestStatusSchema.parse(builderFactPayload(results[statusIndex]));
    },
  };
}

/**
 * Lists editable domain applications (excluding `builtin` and externally `connected` apps)
 * merged with the caller's unpublished draft projects.
 * Deliberately does NOT compute per-application drift so list reads stay fast and bounded.
 */
export async function listBuilderProjects(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  search?: string,
): Promise<BuilderProjectSummary[]> {
  await assertAppBuilderAccess(credentials);
  const client = applicationCatalogueClient(credentials);

  // Page through all maintainable domain applications in the current domain.
  const catalogueRows: Awaited<ReturnType<typeof client.query>>["rows"] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await client.query({ scope: "maintainable", sort: "updated", size: 100, search, ...(cursor && { cursor }) });
    catalogueRows.push(...result.rows);
    if (!result.nextCursor || result.rows.length === 0) break;
    cursor = result.nextCursor;
  }

  const editableApps = catalogueRows.filter(
    row => row.source === "domain" && row.canMaintain && row.canEditEntries,
  );
  return mergeBuilderProjects(owner, credentials.locale, editableApps, search);
}

export const builderProjectRowsSchema = z.array(applicationCatalogueQueryResultSchema.shape.rows.element.pick({
  id: true, names: true, descriptions: true, icon: true, updatedAt: true, canEditEntries: true,
}));

export async function mergeBuilderProjects(
  owner: AssistantOwner, locale: string | undefined, editableApps: z.infer<typeof builderProjectRowsSchema>, search?: string,
): Promise<BuilderProjectSummary[]> {
  const [drafts, projectMap] = await Promise.all([
    appBuilderProjectStore.listDraftsByCreator(owner.domainId, owner.userId),
    appBuilderProjectStore.listByAppIds(owner.domainId, editableApps.map(row => row.id)),
  ]);

  const publishedIds = new Set(editableApps.map(row => row.id));
  const workspaceStatus = new Map<string, Workspace>();
  const boundProjects = [
    ...drafts.filter(draft => !publishedIds.has(draft.appId)),
    ...editableApps.flatMap(row => {
      const bound = projectMap.get(row.id);
      return bound ? [bound] : [];
    }),
  ];

  await Promise.all(boundProjects.map(async bound => {
    const ws = workspaceSchema.parse(
      await appRuntimeClient(owner, bound.appId).request(`/v1/workspaces/${bound.workspaceId}`),
    );
    workspaceStatus.set(bound.appId, ws);
  }));

  const items: BuilderProjectSummary[] = [];

  for (const draft of drafts) {
    if (publishedIds.has(draft.appId) || !draft.draftMeta) continue;
    if (search && ![draft.appId, ...Object.values(draft.draftMeta.names), ...Object.values(draft.draftMeta.descriptions)]
      .some(value => value.toLowerCase().includes(search.toLowerCase()))) continue;
    const ws = workspaceStatus.get(draft.appId);
    items.push({
      appId: draft.appId,
      name: localizedNameOf(draft.draftMeta.names, locale, draft.appId),
      names: draft.draftMeta.names,
      descriptions: draft.draftMeta.descriptions,
      icon: draft.draftMeta.icon,
      published: false,
      workspaceId: draft.workspaceId,
      busy: ws?.activeRunId !== null && ws?.activeRunId !== undefined,
      activeRunId: ws?.activeRunId ?? null,
      updatedAt: ws?.updatedAt ?? draft.updatedAt,
      canEditEntries: false,
    });
  }

  for (const row of editableApps) {
    const bound = projectMap.get(row.id);
    const ws = bound ? workspaceStatus.get(row.id) : undefined;
    items.push({
      appId: row.id,
      name: localizedNameOf(row.names, locale, row.id),
      names: row.names,
      descriptions: row.descriptions,
      icon: row.icon,
      published: true,
      workspaceId: bound?.workspaceId ?? null,
      busy: ws?.activeRunId !== null && ws?.activeRunId !== undefined,
      activeRunId: ws?.activeRunId ?? null,
      updatedAt: ws?.updatedAt ?? row.updatedAt ?? bound?.updatedAt ?? new Date(0).toISOString(),
      canEditEntries: row.canEditEntries,
    });
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return items;
}

async function readWorkspaceFiles(
  runtime: RuntimeClient,
  workspaceId: string,
  commit?: string,
): Promise<WorkspaceFile[]> {
  const query = commit ? `?${new URLSearchParams({ commit })}` : "";
  const tree = (await runtime.request(`/v1/workspaces/${workspaceId}/tree${query}`)) as WorkspaceTree;
  const files = await Promise.all(
    tree.files.map(async entry => {
      const params = new URLSearchParams({ path: entry.path, ...(commit && { commit }) });
      const bytes = await runtime.bytes(`/v1/workspaces/${workspaceId}/files/content?${params}`);
      return {
        path: entry.path,
        encoding: "base64" as const,
        content: bytes.toString("base64"),
      };
    }),
  );
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function previewEntriesFromManifest(manifest: ApplicationSourceManifest, locale?: string): BuilderPreviewEntry[] {
  return manifest.panelUses.filter(isApplicationPanelUse).map(use => ({
    id: use.id,
    panelId: use.panelId,
    label: localizedApplicationText(use.names, resolveLocale(locale))!,
    path: use.path,
  }));
}

/** Reads application identity and workspace status without traversing source files or live definitions. */
export async function getBuilderProjectStatus(owner: AssistantOwner, credentials: AssistantCredentials, appId: string) {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  return readBuilderProjectStatus(ctx, credentials.locale);
}

export async function readBuilderProjectStatus(ctx: AuthorizedProjectContext, locale?: string) {
  const workspaceId = ctx.project?.workspaceId ?? null;
  const workspace = workspaceId === null ? null
    : workspaceSchema.parse(await ctx.runtime.request(`/v1/workspaces/${workspaceId}`));
  return {
    ...ctx.metadata,
    name: localizedNameOf(ctx.metadata.names, locale, ctx.appId),
    published: ctx.published,
    materialized: workspace !== null,
    workspaceId,
    busy: Boolean(workspace?.activeRunId),
    headCommit: workspace?.headCommit ?? null,
  };
}

/** Reads a single application project with drift, source conflicts, and preview state. */
export async function getBuilderProject(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<BuilderProjectDetail> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId);
  return readBuilderProjectDetail(owner.domainId, ctx, credentials.locale, workspaceId =>
    new WorkspaceBuildTests(owner, credentials, workspaceId, appWorkspaceSlot(appId)).current());
}

export async function readBuilderProjectDetail(
  domainId: string, ctx: AuthorizedProjectContext, locale: string | undefined,
  readTest: (workspaceId: string) => BuilderTestStatus | null | Promise<BuilderTestStatus | null>,
): Promise<BuilderProjectDetail> {
  const { appId, project, live, runtime } = ctx;

  let workspace: Workspace | null = null;
  let test: BuilderTestStatus | null = null;
  let workingFiles: WorkspaceFile[] = [];

  if (project) {
    workspace = workspaceSchema.parse(await runtime.request(`/v1/workspaces/${project.workspaceId}`));
    const [currentTest, files] = await Promise.all([
      readTest(project.workspaceId),
      readWorkspaceFiles(runtime, project.workspaceId),
    ]);
    test = currentTest;
    workingFiles = files;
  }

  let sourceKind: "panel" | "empty" = "empty";
  let previewEntries: BuilderPreviewEntry[] = [];
  let conflictFiles: string[] = [];

  if (project) {
    conflictFiles = detectConflictMarkers(workingFiles);
    if (conflictFiles.length > 0) {
      sourceKind = "panel";
    } else {
      try {
        const parsed = parseApplicationSource(workingFiles);
        if (parsed.kind === "panel-app") {
          sourceKind = "panel";
          previewEntries = previewEntriesFromManifest(parsed.application, locale);
        } else if (parsed.kind === "legacy-single-panel") {
          sourceKind = "panel";
          previewEntries = [{ id: "main", panelId: "root", label: "Preview", path: `/applications/${appId}/main` }];
        }
      } catch (error) {
        if (!(error instanceof z.ZodError) && !(error instanceof HttpError && error.code === "APPLICATION_SOURCE_INVALID")) throw error;
        // Malformed intermediate files in working tree still show as panel source so user/agent can fix them.
        sourceKind = workingFiles.some(f => f.path === APPLICATION_SOURCE_FILE || f.path === "panel.json")
          ? "panel"
          : "empty";
      }
    }
  } else if (live) {
    sourceKind = "panel";
    previewEntries = previewEntriesFromManifest(live.snapshot.application, locale);
  }

  const drift = readBuilderProjectDrift(ctx, locale);

  const { names, descriptions, icon } = ctx.metadata;
  const releases = ctx.published && project ? await appBuilderProjectStore.listReleases(domainId, appId) : [];

  return {
    appId,
    name: localizedNameOf(names, locale, appId),
    names,
    descriptions,
    icon,
    published: ctx.published,
    workspaceId: project?.workspaceId ?? null,
    busy: workspace?.activeRunId !== null && workspace?.activeRunId !== undefined,
    activeRunId: workspace?.activeRunId ?? null,
    updatedAt: workspace?.updatedAt ?? project?.updatedAt ?? new Date().toISOString(),
    canEditEntries: live?.applicationMeta.canEditEntries ?? false,
    sourceKind,
    materialized: project !== null,
    headCommit: workspace?.headCommit ?? null,
    openPath: live ? (live.applicationMeta.entryHome ?? live.applicationMeta.entryPath) : null,
    managePath: live ? `/ontology-manager/applications/${encodeURIComponent(appId)}` : null,
    drift,
    conflictFiles,
    hasConflicts: conflictFiles.length > 0,
    test,
    previewEntries,
    foreignPanelIds: live?.foreignPanelIds ?? [],
    foreignProjectionIds: live?.foreignProjectionIds ?? [],
    currentReleaseId: releases[0]?.id ?? null,
  };
}

export function readBuilderProjectDrift(ctx: AuthorizedProjectContext, locale?: string): DriftReport {
  const { appId, live, project } = ctx;
  if (!live || !project?.lastSyncedFingerprint) return { hasDrift: false, items: [] };
  return diffFingerprints(project.lastSyncedFingerprint, computeLiveFingerprint(live.snapshot), {
    applicationLabel: localizedNameOf(live.snapshot.application.declaration.names, locale, appId),
    panelLabels: live.panelLabels,
    projectionLabels: live.projectionLabels,
  });
}

export function builderRestoreBlock(
  state: Pick<BuilderProjectDetail, "materialized" | "busy" | "headCommit">, commit: unknown,
) {
  if (!state.materialized) return "notMaterialized";
  if (state.busy) return "busy";
  if (commit === state.headCommit) return "currentCommit";
}

export function builderRollbackBlock(
  state: Pick<BuilderProjectDetail, "busy" | "drift" | "currentReleaseId">, releaseId: unknown,
) {
  if (state.busy) return "busy";
  if (state.drift.hasDrift) return "driftBlocking";
  if (state.currentReleaseId && releaseId === state.currentReleaseId) return "currentRelease";
}

/**
 * Creates a brand-new unpublished draft project.
 * Writes ONLY to `app_builder_projects` + `agent-runtime` workspace — NEVER to Java `ApplicationCatalog`.
 */
export async function createDraftProject(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  input: { name: string; description?: string; icon?: string },
): Promise<{ appId: string; workspaceId: string }> {
  await assertAppBuilderAccess(credentials);
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "Application name is required", "INVALID_REQUEST");
  const icon = input.icon ?? recommendApplicationIcon(name);
  domainApplicationIconSchema.parse(icon);

  const appId = `app-${randomUUID()}`;
  const runtime = appRuntimeClient(owner, appId);
  const workspace = workspaceSchema.parse(await runtime.request("/v1/workspaces", "POST", { name }));

  const draftMeta: DraftApplicationMeta = {
    names: defaultLocalizedMap(name),
    descriptions: input.description?.trim() ? defaultLocalizedMap(input.description.trim()) : {},
    icon,
  };

  await appBuilderProjectStore.insertProject({
    domainId: owner.domainId,
    appId,
    workspaceId: workspace.id,
    createdBy: owner.userId,
    draftMeta,
  });

  return { appId, workspaceId: workspace.id };
}

export async function updateDraftProjectMeta(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  input: { name?: string; description?: string; icon?: string },
): Promise<AppBuilderProjectRow> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  if (ctx.published || !ctx.project?.draftMeta) {
    throw new HttpError(409, "Published applications are edited via the application identity API", "APPLICATION_PUBLISHED");
  }
  const current = ctx.project.draftMeta;
  const nextName = input.name?.trim();
  if (input.icon !== undefined && input.icon !== current.icon) {
    domainApplicationIconSchema.parse(input.icon);
  }
  const nextMeta: DraftApplicationMeta = {
    names: nextName ? defaultLocalizedMap(nextName) : current.names,
    descriptions: input.description !== undefined
      ? (input.description.trim() ? defaultLocalizedMap(input.description.trim()) : {})
      : current.descriptions,
    icon: input.icon ?? current.icon,
  };
  if (nextName) {
    await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}`, "PATCH", { name: nextName });
  }
  const updated = await appBuilderProjectStore.updateDraftMeta(owner.domainId, appId, nextMeta);
  if (!updated) throw new HttpError(404, "Draft project not found", "NOT_FOUND");
  return updated;
}

/**
 * Lazily materializes an application's git workspace on first explicit write (first chat message
 * or explicit sync). For directly-registered published panel apps, claims unclaimed resources in
 * `app_builder_owned_resources`, serializes the live definition into the initial commit, and
 * records `last_synced_fingerprint` and `last_synced_commit`.
 */
export async function ensureMaterializedWorkspace(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<AppBuilderProjectRow> {
  const { project, runtime } = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  if (project) return project;

  return appBuilderProjectStore.withMaterializationLock(owner.domainId, appId, async client => {
    const existing = await appBuilderProjectStore.findByAppId(owner.domainId, appId, client);
    if (existing) return existing;

    const { snapshot } = await readLiveApplicationSnapshot(owner.domainId, appId, credentials, { claimUnclaimed: true, client });
    const name = localizedNameOf(snapshot.application.declaration.names, credentials.locale, appId);
    const workspace = workspaceSchema.parse(await runtime.request("/v1/workspaces", "POST", { name }));
    const { commit } = z.object({ commit: workspaceCommitSchema }).parse(
      await runtime.request(`/v1/workspaces/${workspace.id}/import`, "POST", {
        files: serializeApplicationSource(snapshot),
        message: "Initialize source from current application definition",
      }),
    );
    return appBuilderProjectStore.insertProject({
      domainId: owner.domainId,
      appId,
      workspaceId: workspace.id,
      createdBy: owner.userId,
      draftMeta: null,
      lastSyncedFingerprint: computeLiveFingerprint(snapshot),
      lastSyncedCommit: commit,
    }, client);
  });
}

/** Reads the file tree of an application's source. Strictly read-only (derives on the fly if not materialized). */
export async function readApplicationSourceFiles(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  commit?: string,
): Promise<Array<{ path: string; size: number }>> {
  return readBuilderSourceFiles(await authorizeBuilderProject(owner, credentials, appId), commit);
}

export async function readBuilderSourceFiles(ctx: AuthorizedProjectContext, commit?: string) {
  if (ctx.project) {
    const query = commit ? `?${new URLSearchParams({ commit })}` : "";
    const tree = (await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}/tree${query}`)) as WorkspaceTree;
    return [...tree.files].sort((a, b) => {
      const pa = PREFERRED_FILES.indexOf(a.path) + 1 || PREFERRED_FILES.length + 1;
      const pb = PREFERRED_FILES.indexOf(b.path) + 1 || PREFERRED_FILES.length + 1;
      return pa - pb || a.path.localeCompare(b.path);
    });
  }
  if (ctx.live) {
    const derived = serializeApplicationSource(ctx.live.snapshot);
    return derived.map(file => ({ path: file.path, size: Buffer.byteLength(file.content, "utf8") }));
  }
  return [];
}

/** Reads a single file from an application's source. Strictly read-only (derives on the fly if not materialized). */
export async function readApplicationSourceFile(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  filePath: string,
  commit?: string,
): Promise<{ path: string; bytes: Buffer }> {
  return readBuilderSourceFile(await authorizeBuilderProject(owner, credentials, appId), filePath, commit);
}

export async function readBuilderSourceFile(ctx: AuthorizedProjectContext, filePath: string, commit?: string) {
  if (ctx.project) {
    const params = new URLSearchParams({ path: filePath, ...(commit && { commit }) });
    const bytes = await ctx.runtime.bytes(`/v1/workspaces/${ctx.project.workspaceId}/files/content?${params}`);
    return { path: filePath, bytes };
  }
  if (ctx.live) {
    const derived = serializeApplicationSource(ctx.live.snapshot);
    const match = derived.find(file => file.path === filePath);
    if (!match) throw new HttpError(404, `File '${filePath}' not found`, "NOT_FOUND");
    return { path: filePath, bytes: Buffer.from(match.content, "utf8") };
  }
  throw new HttpError(404, `File '${filePath}' not found`, "NOT_FOUND");
}

export async function readApplicationSourceCommits(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  offset = 0,
  limit = 30,
): Promise<{ headCommit: string | null; items: WorkspaceCommit[]; hasMore: boolean }> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  const { headCommit, items, hasMore } = await readBuilderSourceCommits(ctx, offset, limit);
  return { headCommit, items, hasMore };
}

export async function readBuilderSourceCommits(ctx: AuthorizedProjectContext, offset: number, limit: number) {
  if (!ctx.project) return { headCommit: null, items: [], hasMore: false, busy: false };
  const [ws, page] = await Promise.all([
    ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}`).then(v => workspaceSchema.parse(v)),
    readBuilderCommitPage(ctx, offset, limit),
  ]);
  return { headCommit: ws.headCommit, ...page, busy: Boolean(ws.activeRunId) };
}

export async function readBuilderCommitPage(ctx: AuthorizedProjectContext, offset: number, limit: number) {
  if (!ctx.project) return { items: [], hasMore: false };
  const page = (await ctx.runtime.request(
    `/v1/workspaces/${ctx.project.workspaceId}/commits?${new URLSearchParams({ offset: String(offset), limit: String(limit + 1) })}`,
  )) as WorkspaceCommitPage;
  return { items: page.items.slice(0, limit), hasMore: page.items.length > limit };
}

async function findCommitInWorkspace(runtime: RuntimeClient, workspaceId: string, targetCommit: string): Promise<WorkspaceCommit> {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { items } = (await runtime.request(
      `/v1/workspaces/${workspaceId}/commits?${new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })}`,
    )) as WorkspaceCommitPage;
    const found = items.find(item => item.id === targetCommit);
    if (found) return found;
    if (items.length < PAGE_SIZE) throw new HttpError(404, "Commit not found", "NOT_FOUND");
  }
}

export async function readApplicationSourceDiff(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  target: string = "latest",
): Promise<{ patch: string; from: string | null; to: string; commit: WorkspaceCommit | null; materialized: boolean }> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  return readBuilderSourceDiff(ctx, target);
}

export async function readBuilderSourceDiff(ctx: AuthorizedProjectContext, target: string) {
  if (!ctx.project) return { patch: "", from: null, to: "working", commit: null, materialized: false };
  const ws = workspaceSchema.parse(await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}`));
  const commit = target === "working"
    ? null
    : await findCommitInWorkspace(ctx.runtime, ctx.project.workspaceId, target === "latest" ? ws.headCommit : target);
  const from = commit ? (commit.parentIds[0] ?? null) : ws.headCommit;
  const to = commit?.id ?? "working";
  if (!from) return { patch: "", from: null, to, commit, materialized: true };
  const diff = (await ctx.runtime.request(
    `/v1/workspaces/${ctx.project.workspaceId}/diff?${new URLSearchParams({ from, to })}`,
  )) as WorkspaceDiff;
  return { patch: diff.patch, from, to, commit, materialized: true };
}

export async function restoreApplicationSourceCommit(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  commit: string,
): Promise<{ commit: string }> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  if (!ctx.project) throw new HttpError(409, "No source history to restore", "SOURCE_NOT_MATERIALIZED");
  const ws = workspaceSchema.parse(await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}`));
  if (ws.activeRunId) throw new HttpError(409, "A conversation is currently modifying this application", "WORKSPACE_BUSY");
  const saved = z.object({ commit: workspaceCommitSchema }).parse(
    await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}/restore`, "POST", { commit }),
  );
  return saved;
}

/**
 * Synchronizes current live platform definitions into the application's source repository
 * using a 3-way merge anchored at `last_synced_commit`.
 * Preserves unpublished local changes alongside platform edits; emits standard conflict markers
 * on overlapping divergent changes and returns the list of conflicted files.
 */
export async function syncApplicationBuilderSource(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<{ commit: string; mergedPaths: string[]; conflictFiles: string[]; hasConflicts: boolean }> {
  const { project: existing, runtime, published } = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  if (!published) {
    throw new HttpError(409, "Unpublished application has no live platform definition to sync", "APPLICATION_NOT_PUBLISHED");
  }

  // If no workspace yet, lazy materialization initializes cleanly from live definition.
  if (!existing) {
    const created = await ensureMaterializedWorkspace(owner, credentials, appId);
    return {
      commit: created.lastSyncedCommit!,
      mergedPaths: [],
      conflictFiles: [],
      hasConflicts: false,
    };
  }

  const ws = workspaceSchema.parse(await runtime.request(`/v1/workspaces/${existing.workspaceId}`));
  if (ws.activeRunId) {
    throw new HttpError(409, "A conversation is currently modifying this application", "WORKSPACE_BUSY");
  }

  const live = await readLiveApplicationSnapshot(owner.domainId, appId, credentials, { claimUnclaimed: true });

  const liveFingerprint = computeLiveFingerprint(live.snapshot);

  const [baseFiles, oursFiles] = await Promise.all([
    existing.lastSyncedCommit
      ? readWorkspaceFiles(runtime, existing.workspaceId, existing.lastSyncedCommit)
      : Promise.resolve<WorkspaceFile[]>([]),
    readWorkspaceFiles(runtime, existing.workspaceId),
  ]);
  const theirsFiles = serializeApplicationSource(live.snapshot);

  const merged = threeWayMergeFiles(baseFiles, oursFiles, theirsFiles);
  const message = merged.hasConflicts
    ? `Sync current platform definition with ${merged.conflictFiles.length} conflict(s)`
    : "Sync current definition from platform";

  const saved = z.object({ commit: workspaceCommitSchema, baselineCommit: workspaceCommitSchema }).parse(
    await runtime.request(`/v1/workspaces/${existing.workspaceId}/import`, "POST", {
      files: merged.files,
      baseline: theirsFiles,
      message,
    }),
  );

  await appBuilderProjectStore.markSynced(owner.domainId, appId, liveFingerprint, saved.baselineCommit, false);
  return {
    commit: saved.commit,
    mergedPaths: merged.mergedPaths,
    conflictFiles: merged.conflictFiles,
    hasConflicts: merged.hasConflicts,
  };
}

function assertNoForeignResourceOwnership(
  appId: string,
  panelOwners: ReadonlyMap<string, string>,
  projectionOwners: ReadonlyMap<string, string>,
): void {
  for (const [panelId, ownerAppId] of panelOwners) {
    if (ownerAppId !== appId) {
      throw new HttpError(
        409,
        `Panel '${panelId}' belongs to application '${ownerAppId}' and cannot be published from '${appId}'`,
        "RESOURCE_OWNED_BY_ANOTHER_APP",
        { kind: "panel", id: panelId, ownerAppId },
      );
    }
  }
  for (const [projectionId, ownerAppId] of projectionOwners) {
    if (ownerAppId !== appId) {
      throw new HttpError(
        409,
        `Projection '${projectionId}' belongs to application '${ownerAppId}' and cannot be published from '${appId}'`,
        "RESOURCE_OWNED_BY_ANOTHER_APP",
        { kind: "projection", id: projectionId, ownerAppId },
      );
    }
  }
}

async function applyPanelSourceToPlatform(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  isPublished: boolean,
  manifest: ApplicationSourceManifest,
  panels: Array<{ id: string; input: ProductPanelInput }>,
  projections: Array<{ id: string; input: ProductProjectionInput }>,
  overrides?: { name?: string; icon?: string },
): Promise<void> {
  const { initialOpenEntryIds: requestedOpenEntries, ...definition } = manifest;
  const initialOpenEntryIds = isPublished ? null : requestedOpenEntries;
  if (initialOpenEntryIds === undefined) {
    throw new HttpError(400, "Choose the entries to open to the domain in initialOpenEntryIds", "APPLICATION_ENTRY_OPENING_REQUIRED");
  }
  // Claim the source resources before publishing any current definitions.
  const claimed: OwnedResourceRef[] = [
    ...panels.filter(p => !isBuiltinProductId(p.id)).map((p): OwnedResourceRef => ({ kind: "panel", resourceId: p.id })),
    ...projections.filter(p => !isBuiltinProductId(p.id)).map((p): OwnedResourceRef => ({ kind: "projection", resourceId: p.id })),
  ];
  if (claimed.length > 0) {
    await transaction(async client => {
      const owners = await appBuilderProjectStore.claimUnclaimedResources(owner.domainId, appId, claimed, client);
      assertNoForeignResourceOwnership(appId, owners.panels, owners.projections);
    });
  }

  // Save projections first, because panels can reference them.
  for (const { id, input } of projections) {
    if (isBuiltinProductId(id)) continue;
    const existing = await findCurrentProduct(owner.domainId, "projection", id);
    if (existing && filesAreCanonicalEqual(existing.definition, input)) continue;
    const revision = existing?.revision ?? 0;
    if (existing && existing.definition.componentId === METRIC_CHART_COMPONENT) {
      const existingDef = existing.definition as Record<string, unknown>;
      const inputRec = input as unknown as Record<string, unknown>;
      if (
        inputRec.componentId !== METRIC_CHART_COMPONENT ||
        !filesAreCanonicalEqual(existingDef.data, inputRec.data) ||
        existingDef.metricId !== inputRec.metricId
      ) {
        throw new HttpError(
          400,
          `Chart projection '${id}' cannot change its component, metric, or source during publish`,
          "CHART_SOURCE_IMMUTABLE",
        );
      }
      await saveCurrentProjection(owner, credentials, id, {
        componentId: METRIC_CHART_COMPONENT,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        revision,
      });
    } else {
      await saveCurrentProjection(owner, credentials, id, { ...input, revision });
    }
  }

  // Save only changed panels.
  for (const { id, input } of panels) {
    if (isBuiltinProductId(id)) continue;
    const existing = await findCurrentProduct(owner.domainId, "panel", id);
    if (existing && filesAreCanonicalEqual(existing.definition, input)) continue;
    await saveCurrentPanel(owner, credentials, id, input, existing?.revision ?? 0);
  }

  // Publish the complete application through its catalogue owner.
  const java = applicationCatalogueClient(credentials);
  const effectiveDeclaration = {
    ...manifest.declaration,
    ...(overrides?.name ? { names: defaultLocalizedMap(overrides.name.trim()) } : {}),
    ...(overrides?.icon ? { icon: overrides.icon } : {}),
  };

  const registration = { ...definition, declaration: effectiveDeclaration };
  if (initialOpenEntryIds === null) await java.publishSource(appId, registration);
  else await java.create(appId, { ...registration, initialOpenEntryIds });


}

/**
 * Publishes a specific git commit of the application's source repository to the live platform.
 * Enforces:
 * - No active agent run (`WORKSPACE_BUSY`).
 * - No unresolved 3-way merge conflict markers (`SOURCE_MERGE_CONFLICTS`).
 * - Server-side drift gate for published apps (`409 APPLICATION_SOURCE_DRIFT` with `driftItems`).
 * - Single-application resource ownership (`409 RESOURCE_OWNED_BY_ANOTHER_APP`).
 */
export async function publishApplicationBuilderSource(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  input: { commit: string; name?: string; icon?: string },
): Promise<{ appId: string; releaseId: string; commit: string }> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId);
  if (!ctx.project) {
    throw new HttpError(409, "No source repository exists to publish", "SOURCE_NOT_MATERIALIZED");
  }
  const ws = workspaceSchema.parse(await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}`));
  if (ws.activeRunId) {
    throw new HttpError(409, "A conversation is currently modifying this application", "WORKSPACE_BUSY");
  }

  // Enforce server-side drift gate BEFORE touching any live resource.
  if (ctx.published && ctx.live && ctx.project.lastSyncedFingerprint) {
    const liveFingerprint = computeLiveFingerprint(ctx.live.snapshot);
    const appLabel = localizedNameOf(
      ctx.live.snapshot.application.declaration.names,
      credentials.locale,
      appId,
    );
    const drift = diffFingerprints(ctx.project.lastSyncedFingerprint, liveFingerprint, {
      applicationLabel: appLabel,
      panelLabels: ctx.live.panelLabels,
      projectionLabels: ctx.live.projectionLabels,
    });
    if (drift.hasDrift) {
      throw new HttpError(
        409,
        "The live application definition changed outside App Builder; sync the current definition into source before publishing",
        "APPLICATION_SOURCE_DRIFT",
        { driftItems: drift.items },
      );
    }
  }

  const exported = workspaceExportSchema.parse(
    await ctx.runtime.request(`/v1/workspaces/${ctx.project.workspaceId}/export`, "POST", { commit: input.commit }),
  );
  const conflicted = detectConflictMarkers(exported.files);
  if (conflicted.length > 0) {
    throw new HttpError(
      409,
      `Resolve merge conflict markers before publishing: ${conflicted.join(", ")}`,
      "SOURCE_MERGE_CONFLICTS",
      { conflictFiles: conflicted },
    );
  }

  const parsed = parseApplicationSource(exported.files);
  if (parsed.kind === "empty") {
    throw new HttpError(400, "This commit has no publishable application files", "COMMIT_NOT_PUBLISHABLE");
  }

  if (parsed.kind === "panel-app") {
    await applyPanelSourceToPlatform(
      owner,
      credentials,
      appId,
      ctx.published,
      parsed.application,
      parsed.panels,
      parsed.projections,
      { name: input.name, icon: input.icon },
    );
  } else if (parsed.kind === "legacy-single-panel") {
    // Read-only compatibility for legacy single-panel roots: wrap into canonical single-entry panel app.
    const panelId = `panel-${appId.replace(/^app-/, "")}`;
    const displayName = input.name?.trim()
      || (ctx.project.draftMeta && localizedNameOf(ctx.project.draftMeta.names, credentials.locale, appId))
      || appId;
    const icon = input.icon ?? ctx.project.draftMeta?.icon ?? recommendApplicationIcon(displayName);
    const manifest: ApplicationSourceManifest = {
      declaration: {
        names: defaultLocalizedMap(displayName),
        descriptions: ctx.project.draftMeta?.descriptions ?? {},
        icon,
        groups: [],
      },
      entry: { path: `/applications/${appId}`, renderer: "panels", home: `/applications/${appId}/main` },
      initialOpenEntryIds: ["main"],
      framePanelId: "builtin-product-platform-frame",
      panelUses: [{
        id: "main",
        pageKey: "main",
        panelId,
        names: defaultLocalizedMap(displayName),
        path: `/applications/${appId}/main`,
      }],
      delivery: { panels: [panelId], projections: [], packages: [], agents: [], skills: [] },
    };
    const panelInput: ProductPanelInput = {
      name: displayName,
      description: "",
      visibility: "private",
      ...parsed.panel,
    };
    await applyPanelSourceToPlatform(owner, credentials, appId, ctx.published, manifest, [{ id: panelId, input: panelInput }], []);
  }

  // Re-read authoritative live snapshot and update baseline fingerprint + clear draft_meta.
  const freshLive = await readLiveApplicationSnapshot(owner.domainId, appId, credentials, { ownedOnly: true });
  const freshFingerprint = computeLiveFingerprint(freshLive.snapshot);
  const release = await transaction(async client => {
    await appBuilderProjectStore.markSynced(owner.domainId, appId, freshFingerprint, input.commit, true, client);
    return appBuilderProjectStore.recordRelease({
      domainId: owner.domainId,
      appId,
      commitId: input.commit,
      publishedBy: owner.userId,
    }, client);
  });

  return { appId, releaseId: release.id, commit: input.commit };
}

/**
 * Rolls back a published panel application by re-publishing its commit through the same drift gate.
 */
export async function rollbackApplicationBuilderRelease(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
  releaseId: string,
): Promise<{ appId: string; releaseId: string; commit: string }> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId);
  if (!ctx.published || !ctx.live || !ctx.project) {
    throw new HttpError(409, "Application has not been published", "APPLICATION_UNAVAILABLE");
  }
  const releases = await appBuilderProjectStore.listReleases(owner.domainId, appId);
  const target = releases.find(r => r.id === releaseId);
  if (!target) throw new HttpError(404, "Release not found", "NOT_FOUND");

  // For panel apps, rollback is simply re-publishing the target release's commit through the same drift-guarded pipeline.
  return publishApplicationBuilderSource(owner, credentials, appId, { commit: target.commitId });
}

export async function listApplicationBuilderReleases(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<AppBuilderReleaseRow[]> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  return readBuilderSourceReleases(owner.domainId, ctx);
}

export function readBuilderSourceReleases(domainId: string, ctx: AuthorizedProjectContext) {
  return appBuilderProjectStore.listReleases(domainId, ctx.appId);
}

async function assertBuilderWorkspaceIdle(runtime: RuntimeClient, workspaceId: string) {
  const workspace = workspaceSchema.parse(await runtime.request(`/v1/workspaces/${workspaceId}`));
  if (workspace.activeRunId) throw new HttpError(409, "A conversation is currently modifying this application", "WORKSPACE_BUSY");
}

export async function assertPublishedBuilderWorkspaceIdle(owner: AssistantOwner, credentials: AssistantCredentials, appId: string) {
  const project = await appBuilderProjectStore.findByAppId(owner.domainId, appId);
  if (!project || project.draftMeta) return;
  const application = await applicationCatalogueClient(credentials).record(appId);
  if (!application.canMaintain) throw new HttpError(403, "Application edit permission required", "PRODUCT_FORBIDDEN");
  await assertBuilderWorkspaceIdle(appRuntimeClient(owner, appId), project.workspaceId);
}

/** Deletes an unpublished draft project (creator-only). */
export async function deleteApplicationBuilderDraft(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<void> {
  const ctx = await authorizeBuilderProject(owner, credentials, appId, { skipLiveRead: true });
  if (ctx.published || !ctx.project?.draftMeta) {
    throw new HttpError(409, "Use applications.delete to remove a published application", "APPLICATION_PUBLISHED");
  }
  await assertBuilderWorkspaceIdle(ctx.runtime, ctx.project.workspaceId);
  await cleanupApplicationBuilderArtifacts(owner, credentials, appId);
}

/**
 * Cleans up any builder project, workspace, build-test context, sessions, and owned-resource claims
 * for `appId`. Invoked both when deleting a draft and by `applications.delete` after removing a
 * published application from Java `ApplicationCatalog`.
 */
export async function cleanupApplicationBuilderArtifacts(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
  appId: string,
): Promise<void> {
  const project = await appBuilderProjectStore.findByAppId(owner.domainId, appId);
  if (project) {
    const runtime = appRuntimeClient(owner, appId);
    await closeWorkspaceBuildTests(owner.domainId, project.workspaceId, credentials.locale);
    await runtime.request(`/v1/workspaces/${project.workspaceId}`, "DELETE");
    const { assistantService } = await import("../assistant/service");
    await assistantService.deleteWorkspaceSessions(owner.domainId, project.workspaceId);
  }
  await transaction(client => appBuilderProjectStore.deleteProject(owner.domainId, appId, client));
}

export function fileLanguageForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const map: Readonly<Record<string, string>> = {
    html: "html", htm: "html", svg: "html", xml: "html",
    js: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript",
    json: "json", md: "markdown", css: "text", txt: "text", csv: "text", yml: "text", yaml: "text",
  };
  return Object.hasOwn(map, extension) ? map[extension]! : "";
}
