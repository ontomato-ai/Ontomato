import { isUtf8 } from "node:buffer";
import { z } from "zod";
import { recommendApplicationIcon } from "@ontomato/contracts/application-icons";
import {
  panelReadParameterSchemas as paramsSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import {
  AGENT_SESSION,
  APPLICATION,
  APPLICATION_CREATE_DRAFT,
  APPLICATION_PUBLISH_BUILDER_SOURCE,
  APPLICATION_UPDATE_BUILDER_META,
} from "@ontomato/contracts/platform-object-types";
import { applicationCatalogSchema, applicationDeclarationSchema } from "@ontomato/contracts/platform-identity";
import { workspaceNameSchema, workspacePageSchema, type WorkspaceCommit } from "@ontomato/contracts/workspaces";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { cachedZodToRuntimeJsonSchema as jsonSchema } from "../../utils/zod-json-schema";
import type { AssistantOwner } from "../assistant/store";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { APPLICATION_NAVIGATION_READ } from "../product-panels/application-catalogue";
import type { PreparedOwnerReadFacts } from "../product-panels/java-panel-reads";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { assertAppBuilderAccess, requireAppBuilderNavigation } from "./access";
import {
  authorizeBuilderProject,
  builderProjectRowsSchema,
  builderPublishBlock,
  canRestartBuilderTest,
  fileLanguageForPath,
  getBuilderProject,
  getBuilderProjectStatus,
  listApplicationBuilderReleases,
  listBuilderProjects,
  mergeBuilderProjects,
  prepareBuilderProjectFacts,
  prepareBuilderProjectMetadataRead,
  readBuilderCommitPage,
  readBuilderProjectDetail,
  readBuilderProjectStatus,
  readApplicationSourceCommits,
  readApplicationSourceDiff,
  readApplicationSourceFile,
  readApplicationSourceFiles,
  type AuthorizedProjectContext,
  type BuilderProjectDetail,
  type BuilderProjectSummary,
} from "./project-service";

const shortCommit = (commit: string) => commit.slice(0, 7);

export const builderDraftFieldsSchema = z.object({
  name: workspaceNameSchema.shape.name,
  description: z.string().max(1000).optional(),
  icon: applicationDeclarationSchema.shape.icon.optional(),
}).strict();

export const builderPublishFieldsSchema = z.object({
  name: workspaceNameSchema.shape.name.optional(),
  icon: applicationDeclarationSchema.shape.icon.optional(),
  commit: paramsSchema.workspaceCommit,
}).strict();

function formDescription(
  fields: PanelFormField[],
  values: PanelFormValues,
  operation: string,
  requestPath: string,
  bodySchema: PanelFormDescription["save"]["bodySchema"],
): PanelFormDescription {
  return { fields, values, errors: [], save: { operation, path: requestPath, method: "POST", bodySchema } };
}

export class ApplicationBuilderReadAdapter {
  constructor(
    readonly owner: AssistantOwner,
    readonly credentials: AssistantCredentials,
  ) {}

  text(key: string, params?: Record<string, string | number>) {
    return tForLocale(this.credentials.locale, `panels.appBuilder.${key}`, params);
  }

  private fieldLabels(keys: readonly string[]) {
    return Object.fromEntries(keys.map(key => [key, this.text(`field.${key}`)]));
  }

  /**
   * Left-rail application list (`platform:Application.builderProjects`).
   * Intentionally omits per-application drift computation (drift is only computed when opening an app or publishing).
   */
  async builderProjects(params: Record<string, unknown>): Promise<PanelRecord[]> {
    const search = paramsSchema.keyword.optional().parse(params.search);
    return this.presentBuilderProjects(await listBuilderProjects(this.owner, this.credentials, search));
  }

  presentBuilderProjects(items: BuilderProjectSummary[]): PanelRecord[] {
    return items.map(item => ({
      className: APPLICATION,
      primaryKey: item.appId,
      label: item.name,
      fields: {
        id: item.appId,
        appId: item.appId,
        name: item.name,
        icon: item.icon,
        published: item.published,
        workspaceId: item.workspaceId ?? "",
        busy: item.busy,
        activeRunId: item.activeRunId ?? "",
        updatedAt: item.updatedAt,
        canMaintain: true,
        canEditEntries: item.canEditEntries,
        statusTag: item.busy ? this.text("statusBusy") : (!item.published ? this.text("unpublishedBadge") : ""),
      },
      tones: {
        busy: item.busy ? "warning" : "default",
        statusTag: item.busy ? "success" : (!item.published ? "info" : "default"),
      },
    }));
  }

  /**
   * Full builder detail for a single application (`platform:Application.builderProject`).
   * Computes live drift, conflict markers, build-test status, and previewable entries on demand.
   */
  async builderProject(appId: string): Promise<PanelRecord> {
    return this.presentBuilderProject(await getBuilderProject(this.owner, this.credentials, appId));
  }

  presentBuilderProject(detail: BuilderProjectDetail): PanelRecord {
    const buildTestStatus = detail.test?.status ?? "NONE";
    const buildTestSampleName = detail.test?.sampleSummary?.name ?? "";
    const buildTestExpiresAt = detail.test?.expiresAt ?? "";
    const buildTestCanRestart = canRestartBuilderTest(detail.test);

    const outputs = {
      appId: detail.appId,
      name: detail.name,
      icon: detail.icon,
      published: detail.published,
      workspaceId: detail.workspaceId ?? "",
      busy: detail.busy,
      materialized: detail.materialized,
      sourceKind: detail.sourceKind,
      headCommit: detail.headCommit ?? "",
      shortHeadCommit: detail.headCommit ? shortCommit(detail.headCommit) : "",
      openPath: detail.openPath ?? "",
      managePath: detail.managePath ?? "",
      hasDrift: detail.drift.hasDrift,
      driftCount: detail.drift.items.length,
      hasConflicts: detail.hasConflicts,
      conflictCount: detail.conflictFiles.length,
      buildTestStatus,
      buildTestSampleName,
      buildTestExpiresAt,
      buildTestCanRestart,
      canEditEntries: detail.canEditEntries,
      currentReleaseId: detail.currentReleaseId ?? "",
      activeRunId: detail.activeRunId ?? "",
      driftItemsJson: JSON.stringify(detail.drift.items),
      conflictFilesJson: JSON.stringify(detail.conflictFiles),
      previewEntriesJson: JSON.stringify(detail.previewEntries),
    };

    return {
      className: APPLICATION,
      primaryKey: detail.appId,
      label: detail.name,
      outputs,
      fieldLabels: this.fieldLabels([
        "shortHeadCommit",
        "busyLabel",
        "buildTestStatusLabel",
        "buildTestSampleName",
        "updatedAt",
      ]),
      fields: {
        ...outputs,
        busyLabel: this.text(detail.busy ? "statusBusy" : "idle"),
        buildTestStatusLabel: this.text(`test.${buildTestStatus}`),
        updatedAt: detail.updatedAt,
        driftItems: { kind: "json", value: detail.drift.items.map(item => ({ ...item })) },
        conflictFiles: detail.conflictFiles,
        previewEntries: { kind: "json", value: detail.previewEntries.map(entry => ({ ...entry })) },
        foreignPanelIds: detail.foreignPanelIds,
        foreignProjectionIds: detail.foreignProjectionIds,
      },
      tones: {
        busyLabel: detail.busy ? "warning" : "default",
        buildTestStatusLabel:
          buildTestStatus === "READY" ? "success"
            : buildTestStatus === "PREPARE_FAILED" ? "danger"
              : buildTestStatus === "NONE" ? "default" : "warning",
      },
    };
  }

  /**
   * Caller-private paginated sessions for this application (`platform:Application.builderSessions`).
   * Row type is `platform:AgentSession` so single-SSE session_run updates refresh running dots automatically.
   */
  async builderSessions(appId: string, params: Record<string, unknown>) {
    const ctx = await authorizeBuilderProject(this.owner, this.credentials, appId, { skipLiveRead: true });
    return this.presentBuilderSessions(ctx.project, params);
  }

  async presentBuilderSessions(project: AuthorizedProjectContext["project"], params: Record<string, unknown>) {
    if (!project) {
      return { rows: [] as PanelRecord[], hasMore: false };
    }
    const cursor = paramsSchema.cursor.optional().parse(params.cursor);
    const limit = paramsSchema.size.optional().parse(params.size)
      ?? paramsSchema.limit.optional().parse(params.limit)
      ?? 10;
    const { assistantService } = await import("../assistant/service");
    const page = await assistantService.list(this.owner, { workspaceId: project.workspaceId, cursor, limit });
    const rows: PanelRecord[] = page.sessions.map(session => {
      const status = session.latestRun?.status ?? "idle";
      const running = status === "running";
      const title = session.title || this.text("untitledSession");
      return {
        className: AGENT_SESSION,
        primaryKey: session.id,
        label: title,
        fields: {
          id: session.id,
          title,
          agentId: session.agentId,
          status,
          running,
          runningDot: running ? this.text("statusBusy") : "",
          statusLabel: this.text(running ? "statusBusy" : `session.${status}`),
          updatedAt: session.updatedAt,
        },
        tones: {
          runningDot: "success",
          statusLabel: running ? "warning" : "default",
        },
      };
    });
    return {
      rows,
      hasMore: page.nextCursor !== null,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async sourceFiles(appId: string, params: Record<string, unknown>): Promise<PanelRecord[]> {
    const commit = paramsSchema.workspaceCommit.optional().parse(params.commit);
    return this.presentSourceFiles(await readApplicationSourceFiles(this.owner, this.credentials, appId, commit));
  }

  presentSourceFiles(files: Awaited<ReturnType<typeof readApplicationSourceFiles>>): PanelRecord[] {
    return files.map(file => {
      const language = fileLanguageForPath(file.path);
      const basename = file.path.split("/").pop() || file.path;
      return {
        primaryKey: file.path,
        label: basename,
        fields: {
          path: file.path,
          size: file.size,
          isText: !!language,
          language,
        },
      };
    });
  }

  async sourceFile(appId: string, params: Record<string, unknown>): Promise<PanelRecord> {
    const filePath = paramsSchema.workspacePath.parse(params.path);
    const commit = paramsSchema.workspaceCommit.optional().parse(params.commit);
    return this.presentSourceFile(await readApplicationSourceFile(this.owner, this.credentials, appId, filePath, commit));
  }

  presentSourceFile(file: Awaited<ReturnType<typeof readApplicationSourceFile>>): PanelRecord {
    const language = fileLanguageForPath(file.path);
    const isText = Boolean(language) && isUtf8(file.bytes);
    return {
      primaryKey: file.path,
      label: file.path,
      fields: {
        path: file.path,
        content: isText ? file.bytes.toString("utf8") : "",
        language,
        isText,
        nonTextNotice: isText ? "" : this.text("notText"),
      },
    };
  }

  async sourceCommits(appId: string, params: Record<string, unknown>) {
    const { offset, limit } = sourceCommitPage(params);
    const page = await readApplicationSourceCommits(this.owner, this.credentials, appId, offset, limit);
    return this.presentSourceCommits(page, offset);
  }

  presentSourceCommits(page: Awaited<ReturnType<typeof readApplicationSourceCommits>>, offset: number) {
    const nextOffset = offset + page.items.length;
    return {
      rows: page.items.map(commit => ({
        primaryKey: commit.id,
        label: commit.message,
        fields: {
          id: commit.id,
          shortId: shortCommit(commit.id),
          parentId: commit.parentIds[0] ?? "",
          message: commit.message,
          isHead: commit.id === page.headCommit,
          isPublishable: commit.parentIds.length > 0,
          createdAt: commit.createdAt,
        },
      })),
      hasMore: page.hasMore,
      ...(page.hasMore ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  async sourceDiff(appId: string, params: Record<string, unknown>): Promise<PanelRecord> {
    const target = paramsSchema.workspaceDiffTarget.optional().parse(params.target) ?? "latest";
    return this.presentSourceDiff(appId, await readApplicationSourceDiff(this.owner, this.credentials, appId, target));
  }

  presentSourceDiff(appId: string, result: Awaited<ReturnType<typeof readApplicationSourceDiff>>): PanelRecord {
    if (!result.materialized) {
      return {
        primaryKey: appId,
        label: this.text("unmaterializedDiffHint"),
        fieldLabels: this.fieldLabels(["targetLabel", "comparisonLabel"]),
        fields: {
          content: "",
          targetLabel: this.text("unmaterializedDiffHint"),
          comparisonLabel: "",
          isEmpty: true,
          materialized: false,
        },
      };
    }
    const targetLabel = result.commit
      ? `${shortCommit(result.commit.id)} · ${result.commit.message}`
      : this.text("uncommitted");
    const comparisonLabel = result.from
      ? this.text(result.commit ? "comparedWith" : "workingComparedWith", { commit: shortCommit(result.from) })
      : this.text("initialCommit");
    return {
      primaryKey: appId,
      label: targetLabel,
      fieldLabels: this.fieldLabels(["targetLabel", "comparisonLabel"]),
      fields: {
        content: result.patch,
        targetLabel,
        comparisonLabel,
        isEmpty: !result.patch,
        materialized: true,
      },
    };
  }

  async sourceReleases(appId: string): Promise<PanelRecord[]> {
    return this.presentSourceReleases(await listApplicationBuilderReleases(this.owner, this.credentials, appId));
  }

  presentSourceReleases(releases: Awaited<ReturnType<typeof listApplicationBuilderReleases>>): PanelRecord[] {
    return releases.map(release => {
      const short = shortCommit(release.commitId);
      return {
        primaryKey: release.id,
        label: short,
        fields: {
          releaseId: release.id,
          appId: release.appId,
          commit: release.commitId,
          shortCommit: short,
          publishedBy: release.publishedBy,
          createdAt: release.createdAt,
          isCurrent: release.id === releases[0]?.id,
        },
      };
    });
  }

  async builderCreateForm(values?: PanelFormValues): Promise<PanelFormDescription> {
    await assertAppBuilderAccess(this.credentials);
    return this.presentBuilderCreateForm(values);
  }

  presentBuilderCreateForm(values?: PanelFormValues): PanelFormDescription {
    const fields: PanelFormField[] = [
      {
        path: "/name",
        label: this.text("name"),
        required: true,
        readOnly: false,
        valueSchema: jsonSchema(builderDraftFieldsSchema.shape.name),
        control: { kind: "text", maxLength: 200 },
      },
      {
        path: "/description",
        label: this.text("description"),
        required: false,
        readOnly: false,
        valueSchema: jsonSchema(z.string().max(1000)),
        control: { kind: "text", multiline: true, maxLength: 1000 },
      },
      {
        path: "/icon",
        label: this.text("icon"),
        required: false,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "application-icon" },
      },
    ];
    return formDescription(
      fields,
      { name: "", description: "", icon: recommendApplicationIcon("application"), ...values },
      APPLICATION_CREATE_DRAFT,
      "/api/app-builder/projects",
      jsonSchema(builderDraftFieldsSchema),
    );
  }

  async builderMetaForm(appId: string, values?: PanelFormValues): Promise<PanelFormDescription> {
    const detail = await getBuilderProjectStatus(this.owner, this.credentials, appId);
    return this.presentBuilderMetaForm(appId, detail, values);
  }

  presentBuilderMetaForm(appId: string, detail: Awaited<ReturnType<typeof readBuilderProjectStatus>>, values?: PanelFormValues) {
    const description = detail.descriptions[this.credentials.locale ?? "en"]
      ?? Object.values(detail.descriptions)[0]
      ?? "";
    const fields: PanelFormField[] = [
      {
        path: "/name",
        label: this.text("name"),
        required: true,
        readOnly: false,
        valueSchema: jsonSchema(builderDraftFieldsSchema.shape.name),
        control: { kind: "text", maxLength: 200 },
      },
      {
        path: "/description",
        label: this.text("description"),
        required: false,
        readOnly: false,
        valueSchema: jsonSchema(z.string().max(1000)),
        control: { kind: "text", multiline: true, maxLength: 1000 },
      },
      {
        path: "/icon",
        label: this.text("icon"),
        required: true,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "application-icon" },
      },
    ];
    return formDescription(
      fields,
      { name: detail.name, description, icon: detail.icon, ...values },
      APPLICATION_UPDATE_BUILDER_META,
      `/api/app-builder/projects/${encodeURIComponent(appId)}/meta`,
      jsonSchema(builderDraftFieldsSchema),
    );
  }

  async builderPublishForm(appId: string, values?: PanelFormValues, defaultCommit?: string): Promise<PanelFormDescription> {
    const detail = await getBuilderProject(this.owner, this.credentials, appId);
    const commitsPage = detail.materialized
      ? await readApplicationSourceCommits(this.owner, this.credentials, appId, 0, 50)
      : { items: [], hasMore: false, headCommit: null };

    return this.presentBuilderPublishForm(detail, commitsPage.items, values, defaultCommit);
  }

  presentBuilderPublishForm(
    detail: BuilderProjectDetail, commits: readonly WorkspaceCommit[], values?: PanelFormValues, defaultCommit?: string,
  ): PanelFormDescription {
    const options = commits.map(commit => {
      const disabledReason = !commit.parentIds.length ? this.text("initialCommit") : null;
      return {
        value: commit.id,
        label: `${shortCommit(commit.id)} · ${commit.message}`,
        description: null,
        disabled: disabledReason !== null,
        disabledReason,
      };
    });
    const preferred = defaultCommit ? options.find(opt => opt.value === defaultCommit && !opt.disabled) : undefined;
    const selected = preferred ?? options.find(opt => !opt.disabled) ?? options[0];

    const block = builderPublishBlock(detail);
    const blocked = block && this.text(block);

    const fields: PanelFormField[] = [
      ...(!detail.published
        ? [{
            path: "/name",
            label: this.text("name"),
            required: true,
            readOnly: false,
            valueSchema: jsonSchema(workspaceNameSchema.shape.name),
            control: { kind: "text" as const, maxLength: 200 },
          }]
        : []),
      {
        path: "/icon",
        label: this.text("icon"),
        required: true,
        readOnly: false,
        valueSchema: { type: "string" },
        control: { kind: "application-icon" },
      },
      {
        path: "/commit",
        label: this.text("commit"),
        required: true,
        readOnly: false,
        valueSchema: jsonSchema(builderPublishFieldsSchema.shape.commit),
        control: { kind: "select", options },
      },
    ];

    return formDescription(
      blocked ? fields.map(field => ({ ...field, readOnly: true, readOnlyReason: blocked })) : fields,
      {
        ...(!detail.published && { name: detail.name }),
        icon: detail.icon,
        commit: selected?.value ?? detail.headCommit ?? null,
        ...values,
      },
      APPLICATION_PUBLISH_BUILDER_SOURCE,
      `/api/app-builder/projects/${encodeURIComponent(detail.appId)}/publish`,
      jsonSchema(builderPublishFieldsSchema),
    );
  }
}

export function createApplicationBuilderReadAdapter(
  owner: AssistantOwner,
  credentials: AssistantCredentials,
): ApplicationBuilderReadAdapter {
  return new ApplicationBuilderReadAdapter(owner, credentials);
}

function builderFormValues(params: Record<string, unknown>) {
  const values = paramsSchema.panelFormValues.optional().parse(params.values);
  requireFormFieldNames(values, "values");
  return values;
}

export async function prepareBuilderPanelRead(
  owner: AssistantOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
) {
  if (selection.typeId !== APPLICATION) return;
  const adapter = new ApplicationBuilderReadAdapter(owner, credentials);
  if (selection.method === "builderCreateForm") {
    const values = builderFormValues(params);
    return {
      call: APPLICATION_NAVIGATION_READ,
      present(payload: unknown) {
        requireAppBuilderNavigation(applicationCatalogSchema.parse(payload));
        return adapter.presentBuilderCreateForm(values);
      },
    };
  }
  if (selection.method === "builderProjects") {
    const search = paramsSchema.keyword.optional().parse(params.search);
    return {
      call: { type: APPLICATION, name: selection.method, parameters: search === undefined ? {} : { search } },
      async present(payload: unknown) {
        const projects = await mergeBuilderProjects(owner, credentials.locale, builderProjectRowsSchema.parse(payload), search);
        return adapter.presentBuilderProjects(projects);
      },
    };
  }
  if (selection.method === "builderSessions" || selection.method === "builderMetaForm") {
    const project = await prepareBuilderProjectMetadataRead(owner, selection.primaryKey!);
    if (selection.method === "builderSessions") {
      return {
        call: project.call,
        present: (payload: unknown) => adapter.presentBuilderSessions(project.present(payload).project, params),
      };
    }
    const values = builderFormValues(params);
    return {
      call: project.call,
      async present(payload: unknown) {
        const ctx = project.present(payload);
        const detail = await readBuilderProjectStatus(ctx, credentials.locale);
        return adapter.presentBuilderMetaForm(ctx.appId, detail, values);
      },
    };
  }
}

export async function prepareBuilderPanelFacts(
  owner: AssistantOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
): Promise<PreparedOwnerReadFacts | undefined> {
  const { typeId, method, primaryKey } = selection;
  if (typeId !== APPLICATION || (method !== "builderProject" && method !== "builderPublishForm")) return;
  const project = await prepareBuilderProjectFacts(owner, primaryKey!, { live: true, status: true });
  const values = method === "builderPublishForm" ? builderFormValues(params) : undefined;
  const defaultCommit = method === "builderPublishForm" ? paramsSchema.workspaceCommit.optional().parse(params.defaultCommit) : undefined;
  const adapter = new ApplicationBuilderReadAdapter(owner, credentials);
  return {
    facts: project.facts,
    async present(_viewer, results) {
      const ctx = await project.context(results);
      const test = project.test(results);
      const detail = await readBuilderProjectDetail(owner.domainId, ctx, credentials.locale, () => test);
      if (method === "builderProject") return adapter.presentBuilderProject(detail);
      const { items } = await readBuilderCommitPage(ctx, 0, 50);
      return adapter.presentBuilderPublishForm(detail, items, values, defaultCommit);
    },
  };
}


export function sourceCommitPage(params: Record<string, unknown>) {
  const cursor = paramsSchema.cursor.optional().parse(params.cursor);
  const parsedCursor = cursor !== undefined && /^\d+$/.test(cursor) ? Number(cursor) : undefined;
  const requestedSize = paramsSchema.size.optional().parse(params.size);
  return workspacePageSchema.parse({
    offset: parsedCursor ?? params.offset,
    limit: requestedSize ?? params.limit,
  });
}
