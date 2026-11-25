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
import { applicationDeclarationSchema } from "@ontomato/contracts/platform-identity";
import { workspaceNameSchema, workspacePageSchema } from "@ontomato/contracts/workspaces";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { cachedZodToRuntimeJsonSchema as jsonSchema } from "../../utils/zod-json-schema";
import type { AssistantOwner } from "../assistant/store";
import { assertAppBuilderAccess } from "./access";
import {
  authorizeBuilderProject,
  fileLanguageForPath,
  getBuilderProject,
  getBuilderProjectStatus,
  listApplicationBuilderReleases,
  listBuilderProjects,
  readApplicationSourceCommits,
  readApplicationSourceDiff,
  readApplicationSourceFile,
  readApplicationSourceFiles,
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
    const items = await listBuilderProjects(this.owner, this.credentials, search);
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
        canEditEntries: item.canEditEntries,
        canGrant: item.canGrant,
      },
      tones: {
        busy: item.busy ? "warning" : "default",
      },
    }));
  }

  /**
   * Full builder detail for a single application (`platform:Application.builderProject`).
   * Computes live drift, conflict markers, build-test status, and previewable entries on demand.
   */
  async builderProject(appId: string): Promise<PanelRecord> {
    const detail = await getBuilderProject(this.owner, this.credentials, appId);
    const buildTestStatus = detail.test?.status ?? "NONE";
    const buildTestSampleName = detail.test?.sampleSummary?.name ?? "";
    const buildTestExpiresAt = detail.test?.expiresAt ?? "";
    const buildTestCanRestart = !!detail.test
      && (detail.test.status === "EXPIRED" || detail.test.status === "CLOSED")
      && !!detail.test.sampleSummary?.name;

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
      canGrant: detail.canGrant,
      currentReleaseId: detail.currentReleaseId ?? "",
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
    if (!ctx.project) {
      return { rows: [] as PanelRecord[], hasMore: false };
    }
    const cursor = paramsSchema.cursor.optional().parse(params.cursor);
    const limit = paramsSchema.limit.optional().parse(params.limit) ?? 10;
    const { assistantService } = await import("../assistant/service");
    const page = await assistantService.list(this.owner, { workspaceId: ctx.project.workspaceId, cursor, limit });
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
          statusLabel: this.text(running ? "statusBusy" : `session.${status}`),
          updatedAt: session.updatedAt,
        },
        tones: {
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
    const files = await readApplicationSourceFiles(this.owner, this.credentials, appId, commit);
    return files.map(file => {
      const language = fileLanguageForPath(file.path);
      return {
        primaryKey: file.path,
        label: file.path,
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
    const file = await readApplicationSourceFile(this.owner, this.credentials, appId, filePath, commit);
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
    const { offset, limit } = workspacePageSchema.parse({ offset: params.offset, limit: params.limit });
    const page = await readApplicationSourceCommits(this.owner, this.credentials, appId, offset, limit);
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
    };
  }

  async sourceDiff(appId: string, params: Record<string, unknown>): Promise<PanelRecord> {
    const target = paramsSchema.workspaceDiffTarget.optional().parse(params.target) ?? "latest";
    const result = await readApplicationSourceDiff(this.owner, this.credentials, appId, target);
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
    const releases = await listApplicationBuilderReleases(this.owner, this.credentials, appId);
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

  async builderPublishForm(appId: string, values?: PanelFormValues): Promise<PanelFormDescription> {
    const detail = await getBuilderProject(this.owner, this.credentials, appId);
    const commitsPage = detail.materialized
      ? await readApplicationSourceCommits(this.owner, this.credentials, appId, 0, 50)
      : { items: [], hasMore: false, headCommit: null };

    const options = commitsPage.items.map(commit => {
      const disabledReason = !commit.parentIds.length ? this.text("initialCommit") : null;
      return {
        value: commit.id,
        label: `${shortCommit(commit.id)} · ${commit.message}`,
        description: null,
        disabled: disabledReason !== null,
        disabledReason,
      };
    });
    const selected = options.find(opt => !opt.disabled) ?? options[0];

    const blocked = detail.busy
      ? this.text("busy")
      : !detail.materialized
        ? this.text("notMaterialized")
        : detail.drift.hasDrift
          ? this.text("driftBlocking")
          : detail.hasConflicts
            ? this.text("conflictsBlocking")
            : null;

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
      `/api/app-builder/projects/${encodeURIComponent(appId)}/publish`,
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
