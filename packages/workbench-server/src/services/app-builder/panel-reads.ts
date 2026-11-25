import path from "node:path";
import { recommendApplicationIcon } from "@ontomato/contracts/application-icons";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { BuildTestContext } from "@ontomato/contracts/build-tests";
import {
  panelReadParameterSchemas as paramsSchema,
  type PanelFormDescription, type PanelFormField, type PanelFormValues, type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { AGENT_SESSION, APP_WORKSPACE, APP_WORKSPACE_CREATE, APP_WORKSPACE_PUBLISH, APP_WORKSPACE_SAVE } from "@ontomato/contracts/platform-object-types";
import { isNativeApplicationEntry, type ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { applicationDeclarationSchema, type ApplicationDeclaration, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import {
  workspaceIdSchema, workspaceNameSchema, workspacePageSchema, workspaceSchema,
  type HostedRelease, type Workspace, type WorkspaceCommit, type WorkspaceCommitPage,
  type WorkspaceDiff, type WorkspacePage, type WorkspaceTree,
} from "@ontomato/contracts/workspaces";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema as jsonSchema } from "../../utils/zod-json-schema";
import type { AssistantOwner } from "../assistant/store";
import { assertAppBuilderAccess } from "./access";
import { WorkspaceBuildTests } from "./build-tests";

const PAGE_SIZE = 100;
const preferredFiles = ["panel.json", "panel.html", "index.html"];
const languages: Readonly<Record<string, string>> = {
  html: "html", htm: "html", svg: "html", xml: "html",
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript",
  json: "json", md: "markdown", css: "text", txt: "text", csv: "text", yml: "text", yaml: "text",
};
function fileLanguage(file: string) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return Object.hasOwn(languages, extension) ? languages[extension]! : "";
}
const filePriority = (file: string) => (preferredFiles.indexOf(file) + 1 || preferredFiles.length + 1);
const shortCommit = (commit: string) => commit.slice(0, 7);

export const publicationFields = workspaceNameSchema.partial().extend({
  icon: applicationDeclarationSchema.shape.icon,
  commit: paramsSchema.workspaceCommit,
});

function form(fields: PanelFormField[], values: PanelFormValues, operation: string, requestPath: string, bodySchema: PanelFormDescription["save"]["bodySchema"]): PanelFormDescription {
  return { fields, values, errors: [], save: { operation, path: requestPath, method: "POST", bodySchema } };
}

export function catalogDeclaration(app: CatalogApplication): ApplicationDeclaration {
  const panelUses = app.panelUses?.filter((entry): entry is ApplicationPanelUse => !isNativeApplicationEntry(entry));
  return {
    names: app.names, descriptions: app.descriptions, icon: app.icon, groups: app.groups ?? [], permissions: [],
    ...(panelUses && { panelUses }),
  };
}

export function restartSample(test: BuildTestContext | null) {
  return test && (test.status === "EXPIRED" || test.status === "CLOSED") ? test.sampleSummary.name : null;
}

export class AppWorkspaceOwner {
  readonly runtime: RuntimeClient;

  constructor(readonly owner: AssistantOwner, readonly credentials: AssistantCredentials) {
    this.runtime = new RuntimeClient(owner.domainId, undefined, owner.userId);
  }

  text(key: string, params?: Record<string, string | number>) {
    return tForLocale(this.credentials.locale, `panels.appWorkspace.${key}`, params);
  }

  async workspace(id: string) {
    return workspaceSchema.parse(await this.runtime.request(this.path(id)));
  }

  async owned(id: string) {
    const catalog = await assertAppBuilderAccess(this.credentials);
    return { workspace: await this.workspace(id), catalog };
  }

  path(id: string) {
    return `/v1/workspaces/${workspaceIdSchema.parse(id)}`;
  }

  tests(id: string) {
    return new WorkspaceBuildTests(this.owner, this.credentials, id);
  }

  async publication(id: string, catalog: CatalogApplication[]) {
    const { workspaceReleases } = await import("../workspaces/hosted-apps");
    const releases: HostedRelease[] = await workspaceReleases(this.owner, id);
    const appId = releases[0]?.appId;
    const application = appId ? catalog.find(app => app.id === appId) : undefined;
    const current = releases.find(release => release.releaseId === application?.releaseId);
    return { releases, application, current };
  }

  async sessionsFor(id: string) {
    const { workspaceSessions } = await import("../workspaces/sessions");
    const sessions = [];
    let cursor: string | undefined;
    do {
      const page = await workspaceSessions(this.owner, id, { cursor, limit: PAGE_SIZE });
      sessions.push(...page.sessions);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return sessions;
  }

  async commitPage(id: string, offset: number, limit: number) {
    return (await this.runtime.request(`${this.path(id)}/commits?offset=${offset}&limit=${limit}`) as WorkspaceCommitPage).items;
  }

  async *commitHistory(id: string) {
    for (let offset = 0;; offset += PAGE_SIZE) {
      const items = await this.commitPage(id, offset, PAGE_SIZE);
      yield* items;
      if (items.length < PAGE_SIZE) return;
    }
  }

  async findCommit(id: string, hash: string) {
    for await (const commit of this.commitHistory(id)) {
      if (commit.id === hash) return commit;
    }
    throw new HttpError(404, this.text("commitMissing"), "COMMIT_NOT_FOUND");
  }

  async tree(id: string, commit?: string) {
    const query = commit ? `?commit=${commit}` : "";
    return (await this.runtime.request(`${this.path(id)}/tree${query}`) as WorkspaceTree).files;
  }

  publishBlock(commit: WorkspaceCommit, currentCommit?: string) {
    if (!commit.parentIds.length) return this.text("initialCommit");
    if (commit.id === currentCommit) return this.text("alreadyPublished");
    return null;
  }

  private fieldLabels(keys: readonly string[]) {
    return Object.fromEntries(keys.map(key => [key, this.text(`field.${key}`)]));
  }

  private summary(workspace: Workspace, application?: CatalogApplication): PanelRecord {
    const { id, name, headCommit, activeRunId, createdAt, updatedAt } = workspace;
    const busy = activeRunId !== null;
    const busyStatus = busy ? "BUSY" : "IDLE";
    return {
      className: APP_WORKSPACE, primaryKey: id, label: name,
      fieldLabels: this.fieldLabels(["shortHeadCommit", "busyLabel", "publishedAppName", "updatedAt"]),
      fields: {
        id, name, headCommit, shortHeadCommit: shortCommit(headCommit), activeRunId: activeRunId ?? "", busy, busyStatus,
        busyLabel: this.text(busy ? "statusBusy" : "idle"), createdAt, updatedAt,
        publishedAppId: application?.id ?? "",
        publishedAppName: application ? localizedApplicationText(application.names, this.credentials.locale) ?? application.id : "",
      },
      tones: { busyLabel: busy ? "warning" : "default" },
    };
  }

  async list(params: Record<string, unknown>) {
    const catalog = await assertAppBuilderAccess(this.credentials);
    const search = paramsSchema.keyword.optional().parse(params.search)?.trim().toLowerCase();
    const { offset, limit } = workspacePageSchema.parse({ offset: params.offset, limit: params.limit });
    const read = async (start: number, size: number) => (await this.runtime.request(
      `/v1/workspaces?offset=${start}&limit=${size}`,
    ) as WorkspacePage).items;
    let items: Workspace[];
    let hasMore: boolean;
    if (search) {
      const matches: Workspace[] = [];
      let skipped = 0;
      for (let start = 0; matches.length <= limit; start += PAGE_SIZE) {
        const page = await read(start, PAGE_SIZE);
        for (const item of page) {
          if (!item.name.toLowerCase().includes(search)) continue;
          if (skipped < offset) skipped++;
          else matches.push(item);
          if (matches.length > limit) break;
        }
        if (page.length < PAGE_SIZE) break;
      }
      items = matches.slice(0, limit);
      hasMore = matches.length > limit;
    } else {
      items = await read(offset, limit);
      hasMore = items.length === limit && (await read(offset + limit, 1)).length > 0;
    }
    return {
      rows: await Promise.all(items.map(async workspace => this.summary(workspace, (await this.publication(workspace.id, catalog)).application))),
      hasMore,
    };
  }

  async record(id: string): Promise<PanelRecord> {
    const { workspace, catalog } = await this.owned(id);
    const [files, test, { application, current }] = await Promise.all([
      this.tree(id),
      this.tests(id).current().catch(() => "UNAVAILABLE" as const),
      this.publication(id, catalog),
    ]);
    const paths = new Set(files.map(file => file.path));
    const hasPanelCandidate = paths.has("panel.json") && paths.has("panel.html");
    const hasHostedIndex = paths.has("index.html");
    const buildTestStatus = test === "UNAVAILABLE" ? test : test?.status ?? "NONE";
    const canManagePermissions = catalog.some(app => app.entry.path === "/permissions");
    const row = this.summary(workspace, application);
    const outputs = {
      name: workspace.name,
      busy: workspace.activeRunId !== null,
      headCommit: workspace.headCommit,
      shortHeadCommit: shortCommit(workspace.headCommit),
      hasPanelCandidate,
      candidatePreviewPath: hasPanelCandidate ? `/app-builder/${id}/panel-preview/working/preview` : "",
      hasHostedIndex,
      hostedPreviewPath: hasHostedIndex ? `/app-builder/${id}/hosted-preview` : "",
      published: !!application,
      publishedAppId: application?.id ?? "",
      publishedAppName: String(row.fields.publishedAppName),
      publishedAppPath: application?.entry.path ?? "",
      buildTestStatus,
      buildTestCanRestart: test !== "UNAVAILABLE" && !!restartSample(test),
      canManagePermissions,
      permissionsPath: canManagePermissions ? "/permissions" : "",
      privateWorkspaces: this.owner.userId !== "system" || this.owner.domainId !== "1",
    };
    return {
      ...row, outputs,
      fieldLabels: {
        ...row.fieldLabels,
        ...this.fieldLabels(["buildTestStatusLabel", "buildTestSampleName"]),
      },
      fields: {
        ...row.fields, ...outputs, buildTestStatusLabel: this.text(`test.${buildTestStatus}`),
        buildTestSampleName: test === "UNAVAILABLE" ? "" : test?.sampleSummary.name ?? "",
        currentReleaseId: current?.releaseId ?? "", currentShortCommit: current ? shortCommit(current.commit) : "",
        publishedAppIcon: application?.icon ?? "",
      },
      tones: {
        ...row.tones,
        buildTestStatusLabel: buildTestStatus === "READY" ? "success"
          : buildTestStatus === "PREPARE_FAILED" || buildTestStatus === "UNAVAILABLE" ? "danger"
            : buildTestStatus === "NONE" ? "default" : "warning",
      },
    };
  }

  private nameField(label = "name"): PanelFormField {
    return { path: "/name", label: this.text(label), required: true, readOnly: false,
      valueSchema: jsonSchema(workspaceNameSchema.shape.name), control: { kind: "text", maxLength: 200 } };
  }

  async createForm(values?: PanelFormValues) {
    await assertAppBuilderAccess(this.credentials);
    return form([this.nameField()], { name: "", ...values }, APP_WORKSPACE_CREATE, "/api/workspaces", jsonSchema(workspaceNameSchema));
  }

  async form(id: string, values?: PanelFormValues) {
    const { workspace } = await this.owned(id);
    return form([this.nameField()], { name: workspace.name, ...values }, APP_WORKSPACE_SAVE, `/api/workspaces/${id}`, jsonSchema(workspaceNameSchema));
  }

  async files(id: string, params: Record<string, unknown>): Promise<PanelRecord[]> {
    await assertAppBuilderAccess(this.credentials);
    const files = await this.tree(id, paramsSchema.workspaceCommit.optional().parse(params.commit));
    return files.sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path))
      .map(({ path: file, size }) => {
        const language = fileLanguage(file);
        return { primaryKey: file, label: file, fields: { path: file, size, isText: !!language, language } };
      });
  }

  async file(id: string, params: Record<string, unknown>): Promise<PanelRecord> {
    await assertAppBuilderAccess(this.credentials);
    const file = paramsSchema.workspacePath.parse(params.path);
    const commit = paramsSchema.workspaceCommit.optional().parse(params.commit);
    const language = fileLanguage(file);
    const query = new URLSearchParams({ path: file, ...(commit && { commit }) });
    let content = "";
    if (language) {
      content = (await this.runtime.bytes(`${this.path(id)}/files/content?${query}`)).toString("utf8");
    } else if (!(await this.tree(id, commit)).some(entry => entry.path === file)) {
      throw new HttpError(404, this.text("fileMissing"), "NOT_FOUND");
    }
    return { primaryKey: file, label: file, fields: { path: file, content, language, isText: !!language, nonTextNotice: language ? "" : this.text("notText") } };
  }

  async commits(id: string, params: Record<string, unknown>) {
    const { workspace } = await this.owned(id);
    const { offset, limit } = workspacePageSchema.parse(params);
    const items = await this.commitPage(id, offset, limit);
    const hasMore = items.length === limit && (await this.commitPage(id, offset + limit, 1)).length > 0;
    return {
      rows: items.map(commit => ({
        primaryKey: commit.id, label: commit.message,
        fields: {
          id: commit.id, shortId: shortCommit(commit.id), parentId: commit.parentIds[0] ?? "",
          message: commit.message, isHead: commit.id === workspace.headCommit,
          isPublishable: commit.parentIds.length > 0, createdAt: commit.createdAt,
        },
      })),
      hasMore,
    };
  }

  async diff(id: string, params: Record<string, unknown>): Promise<PanelRecord> {
    const { workspace } = await this.owned(id);
    const target = paramsSchema.workspaceDiffTarget.optional().parse(params.target) ?? "latest";
    const commit = target === "working" ? null : await this.findCommit(id, target === "latest" ? workspace.headCommit : target);
    const from = commit ? commit.parentIds[0] : workspace.headCommit;
    const to = commit?.id ?? "working";
    const content = from
      ? (await this.runtime.request(`${this.path(id)}/diff?${new URLSearchParams({ from, to })}`) as WorkspaceDiff).patch
      : "";
    const targetLabel = commit ? `${shortCommit(commit.id)} · ${commit.message}` : this.text("uncommitted");
    const comparisonLabel = from
      ? this.text(commit ? "comparedWith" : "workingComparedWith", { commit: shortCommit(from) })
      : this.text("initialCommit");
    return {
      primaryKey: id, label: targetLabel,
      fieldLabels: this.fieldLabels(["targetLabel", "comparisonLabel"]),
      fields: { content, comparisonLabel, targetLabel, isEmpty: !content },
    };
  }

  async sessions(id: string): Promise<PanelRecord[]> {
    const { workspace } = await this.owned(id);
    return (await this.sessionsFor(id)).map(session => {
      const isOccupying = workspace.activeRunId !== null && session.latestRun?.id === workspace.activeRunId;
      const status = session.latestRun?.status ?? "idle";
      const title = session.title || this.text("untitledSession");
      const query = new URLSearchParams({
        agentId: session.agentId,
        sessionId: session.id,
        page: `/app-builder/workspace?workspace=${id}`,
      });
      return {
        className: AGENT_SESSION, primaryKey: session.id, label: title,
        fields: { title, status, statusLabel: this.text(isOccupying ? "statusBusy" : `session.${status}`), isOccupying, updatedAt: session.updatedAt },
        tones: { statusLabel: isOccupying ? "warning" : "default" },
        outputs: { openPath: `/agents/chat?${query}` },
      };
    });
  }

  async releases(id: string): Promise<PanelRecord[]> {
    const { catalog } = await this.owned(id);
    const { releases, current } = await this.publication(id, catalog);
    const missing = new Set(releases.map(release => release.commit));
    const messages = new Map<string, string>();
    if (missing.size) {
      for await (const commit of this.commitHistory(id)) {
        if (missing.delete(commit.id)) messages.set(commit.id, commit.message);
        if (!missing.size) break;
      }
    }
    return releases.map(release => {
      const short = shortCommit(release.commit);
      return {
        primaryKey: release.releaseId, label: messages.get(release.commit) ?? short,
        fields: { ...release, createdAt: new Date(release.createdAt).toISOString(), shortCommit: short, commitMessage: messages.get(release.commit) ?? "", isCurrent: release.releaseId === current?.releaseId },
      };
    });
  }

  async publishForm(id: string, draft?: PanelFormValues) {
    const { workspace, catalog } = await this.owned(id);
    const { application, current } = await this.publication(id, catalog);
    const options = [];
    for await (const commit of this.commitHistory(id)) {
      const disabledReason = this.publishBlock(commit, current?.commit);
      options.push({
        value: commit.id, label: `${shortCommit(commit.id)} · ${commit.message}`, description: null,
        disabled: disabledReason !== null, disabledReason,
      });
    }
    const selected = options.find(option => !option.disabled);
    const blocked = workspace.activeRunId ? this.text("busy")
      : !selected ? this.text("noPublishableCommit") : null;
    const name = typeof draft?.name === "string" ? draft.name : workspace.name;
    const fields: PanelFormField[] = [
      ...(!application ? [this.nameField("appName")] : []),
      { path: "/icon", label: this.text("icon"), required: true, readOnly: false, valueSchema: { type: "string" }, control: { kind: "application-icon" } },
      { path: "/commit", label: this.text("commit"), required: true, readOnly: false, valueSchema: jsonSchema(publicationFields.shape.commit), control: { kind: "select", options } },
    ];
    return form(
      blocked ? fields.map(field => ({ ...field, readOnly: true, readOnlyReason: blocked })) : fields,
      { ...(!application && { name }), icon: application?.icon ?? recommendApplicationIcon(name), commit: selected?.value ?? null, ...draft },
      APP_WORKSPACE_PUBLISH, `/api/workspaces/${id}/publish`, jsonSchema(publicationFields),
    );
  }
}
