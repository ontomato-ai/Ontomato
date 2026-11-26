import { z } from "zod";
import type { RuntimeJsonObject } from "@ontomato/contracts/agent-runtime-values";
import { domainApplicationIconSchema } from "@ontomato/contracts/application-icons";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import {
  APPLICATION,
  APPLICATION_CREATE_DRAFT,
  APPLICATION_DELETE_DRAFT,
  APPLICATION_PUBLISH_BUILDER_SOURCE,
  APPLICATION_RESTART_BUILD_TEST,
  APPLICATION_RESTORE_SOURCE_COMMIT,
  APPLICATION_ROLLBACK_BUILDER_RELEASE,
  APPLICATION_SYNC_BUILDER_SOURCE,
  APPLICATION_UPDATE_BUILDER_META,
} from "@ontomato/contracts/platform-object-types";
import { workspaceIdSchema, workspaceRestoreSchema } from "@ontomato/contracts/workspaces";
import { supportedLocales, tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { applicationCatalogueClient } from "../product-panels/application-catalogue";
import type {
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelWriteServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { WorkspaceBuildTests } from "./build-tests";
import { appWorkspaceSlot } from "./project-store";
import {
  authorizeBuilderProject,
  createDraftProject,
  deleteApplicationBuilderDraft,
  getBuilderProject,
  getBuilderProjectStatus,
  listApplicationBuilderReleases,
  publishApplicationBuilderSource,
  restoreApplicationSourceCommit,
  rollbackApplicationBuilderRelease,
  syncApplicationBuilderSource,
  updateDraftProjectMeta,
} from "./project-service";
import { builderDraftFieldsSchema, builderPublishFieldsSchema } from "./application-panel-reads";

const appIdSchema = z.string().min(1).max(128);
const appTarget = z.object({
  kind: z.literal("object"),
  objectType: z.literal(APPLICATION),
  primaryKey: appIdSchema,
}).strict();
const empty = z.object({}).strict();
const releaseInput = z.object({ releaseId: workspaceIdSchema }).strict();
const publicationResult = z.object({
  appId: z.string(),
  releaseId: workspaceIdSchema,
  commit: workspaceRestoreSchema.shape.commit,
}).strict();
const syncResult = z.object({
  commit: z.string(),
  hasConflicts: z.boolean(),
  conflictFiles: z.array(z.string()),
  mergedPaths: z.array(z.string()),
}).strict();

const binding = (id: string) => ({ kind: "PlatformOperation" as const, id });
const appRef = (primaryKey: string) => ({ objectType: APPLICATION, primaryKey });
const draftInput = (input: Record<string, unknown>) => panelFormSaveInputSchema.parse(input).values;

function text(locale: string | undefined, key: string, params?: Record<string, string | number>) {
  return tForLocale(locale, `panels.appBuilder.${key}`, params);
}

function success(appId: string, data: RuntimeJsonObject = {}): SinglePanelOperationOutcome {
  return {
    kind: "success",
    data,
    affected: {
      objects: [appRef(appId)],
      objectTypes: [APPLICATION],
    },
  };
}

async function execute(run: () => Promise<SinglePanelOperationOutcome>): Promise<SinglePanelOperationOutcome> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) {
      return { kind: "refusal", code: error.code ?? "INVALID_REQUEST", message: error.message };
    }
    if (error instanceof z.ZodError) {
      return { kind: "refusal", code: "INVALID_REQUEST", message: error.message };
    }
    throw error;
  }
}

const appActionBase = {
  kind: "action",
  effect: "write",
  batch: false,
  targetType: APPLICATION,
  targetSchema: appTarget,
  targetInput: "app",
  async targetLabel(host: PanelOperationHost, target: PanelRecordTarget) {
    const detail = await getBuilderProjectStatus(host.initiator.owner, host.initiator.credentials, target.primaryKey);
    return detail.name;
  },
} as const;

const appFormSaveBase = {
  kind: "form.save",
  effect: "write",
  batch: false,
  targetType: APPLICATION,
  targetSchema: appTarget,
  inputSchema: panelFormSaveInputSchema,
  draftInput,
} as const;

async function busyUnavailable(host: PanelOperationHost, target: PanelRecordTarget | null) {
  if (!target) return;
  const detail = await getBuilderProjectStatus(host.initiator.owner, host.initiator.credentials, target.primaryKey);
  if (detail.busy) return { reason: text(host.locale ?? host.initiator.credentials.locale, "busy") };
}

export const applicationBuilderServerOperations = [
  {
    ...appFormSaveBase,
    targetSchema: panelFormTargetSchema.options[1],
    create: true,
    handlerRef: APPLICATION_CREATE_DRAFT,
    binding: binding(APPLICATION_CREATE_DRAFT),
    labelKey: "panels.appBuilder.createDraft",
    resultSchema: z.object({ id: appIdSchema }).strict(),
    async execute({ executor }: PanelOperationHost, _target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const body = builderDraftFieldsSchema.parse(draftInput(input));
        const created = await createDraftProject(executor.owner, executor.credentials, body);
        return {
          ...success(created.appId, { id: created.appId }),
          created: appRef(created.appId),
        };
      });
    },
  },
  {
    ...appFormSaveBase,
    handlerRef: APPLICATION_UPDATE_BUILDER_META,
    binding: binding(APPLICATION_UPDATE_BUILDER_META),
    labelKey: "panels.appBuilder.updateMeta",
    resultSchema: empty,
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const body = builderDraftFieldsSchema.parse(draftInput(input));
        const ctx = await authorizeBuilderProject(executor.owner, executor.credentials, primaryKey, { skipLiveRead: true });
        if (!ctx.published) {
          await updateDraftProjectMeta(executor.owner, executor.credentials, primaryKey, body);
          return success(primaryKey);
        }
        // Published applications update metadata through Java ApplicationCatalog identity API.
        const detail = await getBuilderProjectStatus(executor.owner, executor.credentials, primaryKey);
        if (body.icon && body.icon !== detail.icon) {
          domainApplicationIconSchema.parse(body.icon);
        }
        const locales = supportedLocales();
        const names = body.name.trim() === detail.name ? detail.names
          : Object.fromEntries(locales.map(locale => [locale, body.name.trim()]));
        const description = detail.descriptions[executor.credentials.locale ?? "en"] ?? Object.values(detail.descriptions)[0] ?? "";
        const descriptions = body.description !== undefined && body.description.trim() !== description
          ? (body.description.trim() ? Object.fromEntries(locales.map(locale => [locale, body.description!.trim()])) : {})
          : detail.descriptions;
        await applicationCatalogueClient(executor.credentials).saveIdentity(primaryKey, {
          names,
          descriptions,
          icon: body.icon ?? detail.icon,
        });
        return success(primaryKey);
      });
    },
  },
  {
    ...appActionBase,
    handlerRef: APPLICATION_DELETE_DRAFT,
    binding: binding(APPLICATION_DELETE_DRAFT),
    labelKey: "panels.appBuilder.deleteDraft",
    inputSchema: empty,
    resultSchema: empty,
    async unavailable(host, target) {
      if (!target) return;
      const locale = host.locale ?? host.initiator.credentials.locale;
      const detail = await getBuilderProjectStatus(host.initiator.owner, host.initiator.credentials, target.primaryKey);
      if (detail.published) return { reason: text(locale, "draftOnly") };
      if (detail.busy) return { reason: text(locale, "busy") };
    },
    async unavailableBatch(host, targets) {
      const locale = host.locale ?? host.initiator.credentials.locale;
      const reasons = new Map<string, { reason: string }>();
      for (const { rowKey, row } of targets) {
        if (row!.fields.published === true) reasons.set(rowKey, { reason: text(locale, "draftOnly") });
        else if (row!.fields.busy === true) reasons.set(rowKey, { reason: text(locale, "busy") });
      }
      return reasons;
    },
    inspectImpact: {
      handlerRef: `${APPLICATION_DELETE_DRAFT}.inspect-impact`,
      async inspect({ initiator, locale }, [call]) {
        const { primaryKey } = appTarget.parse(call.target);
        const detail = await getBuilderProjectStatus(initiator.owner, initiator.credentials, primaryKey);
        const loc = locale ?? initiator.credentials.locale;
        if (detail.published) throw new HttpError(409, text(loc, "draftOnly"), "APPLICATION_PUBLISHED");
        if (detail.busy) throw new HttpError(409, text(loc, "busy"), "WORKSPACE_BUSY");
        let count = 0;
        if (detail.workspaceId) {
          const { assistantService } = await import("../assistant/service");
          let cursor: string | undefined;
          do {
            const page = await assistantService.list(initiator.owner, { workspaceId: detail.workspaceId, cursor, limit: 100 });
            count += page.sessions.length;
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
        }
        return {
          summary: text(loc, "deleteDraftImpact", { name: detail.name, count }),
          total: count + 1,
          objects: [{ target: appRef(primaryKey), label: detail.name }],
        };
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        await deleteApplicationBuilderDraft(executor.owner, executor.credentials, primaryKey);
        return {
          kind: "success",
          data: {},
          affected: {
            objects: [],
            objectTypes: [APPLICATION],
            removed: [appRef(primaryKey)],
          },
        };
      });
    },
  },
  {
    ...appActionBase,
    handlerRef: APPLICATION_RESTORE_SOURCE_COMMIT,
    binding: binding(APPLICATION_RESTORE_SOURCE_COMMIT),
    labelKey: "panels.appBuilder.restoreCommit",
    inputSchema: workspaceRestoreSchema,
    resultSchema: empty,
    async unavailableForInput(host, target, input) {
      if (!target) return;
      const locale = host.locale ?? host.initiator.credentials.locale;
      const detail = await getBuilderProjectStatus(host.initiator.owner, host.initiator.credentials, target.primaryKey);
      if (!detail.materialized) return { reason: text(locale, "notMaterialized") };
      if (detail.busy) return { reason: text(locale, "busy") };
      if (input.commit === detail.headCommit) return { reason: text(locale, "currentCommit") };
    },
    async unavailableBatch(host, targets) {
      const locale = host.locale ?? host.initiator.credentials.locale;
      const details = new Map(await Promise.all([...new Set(targets.map(({ target }) => target.primaryKey))].map(async primaryKey => [
        primaryKey,
        await getBuilderProjectStatus(host.initiator.owner, host.initiator.credentials, primaryKey),
      ] as const)));
      const reasons = new Map<string, { reason: string }>();
      for (const { rowKey, target, row } of targets) {
        const detail = details.get(target.primaryKey)!;
        if (!detail.materialized) reasons.set(rowKey, { reason: text(locale, "notMaterialized") });
        else if (detail.busy) reasons.set(rowKey, { reason: text(locale, "busy") });
        else if (row!.primaryKey === detail.headCommit) reasons.set(rowKey, { reason: text(locale, "currentCommit") });
      }
      return reasons;
    },
    inspectImpact: {
      handlerRef: `${APPLICATION_RESTORE_SOURCE_COMMIT}.inspect-impact`,
      async inspect({ initiator, locale }, [call]) {
        const { primaryKey } = appTarget.parse(call.target);
        const { commit } = workspaceRestoreSchema.parse(call.input);
        const detail = await getBuilderProjectStatus(initiator.owner, initiator.credentials, primaryKey);
        const loc = locale ?? initiator.credentials.locale;
        if (!detail.materialized) throw new HttpError(409, text(loc, "notMaterialized"), "SOURCE_NOT_MATERIALIZED");
        if (detail.busy) throw new HttpError(409, text(loc, "busy"), "WORKSPACE_BUSY");
        if (commit === detail.headCommit) throw new HttpError(409, text(loc, "currentCommit"), "CURRENT_COMMIT");
        return {
          summary: text(loc, "restoreImpact", { name: detail.name, commit: commit.slice(0, 7) }),
          total: 1,
          objects: [{ target: appRef(primaryKey), label: detail.name }],
        };
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const { commit } = workspaceRestoreSchema.parse(input);
        await restoreApplicationSourceCommit(executor.owner, executor.credentials, primaryKey, commit);
        return success(primaryKey);
      });
    },
  },
  {
    ...appActionBase,
    handlerRef: APPLICATION_SYNC_BUILDER_SOURCE,
    binding: binding(APPLICATION_SYNC_BUILDER_SOURCE),
    labelKey: "panels.appBuilder.syncSource",
    inputSchema: empty,
    resultSchema: syncResult,
    unavailable: busyUnavailable,
    inspectImpact: {
      handlerRef: `${APPLICATION_SYNC_BUILDER_SOURCE}.inspect-impact`,
      async inspect({ initiator, locale }, [call]) {
        const { primaryKey } = appTarget.parse(call.target);
        const detail = await getBuilderProjectStatus(initiator.owner, initiator.credentials, primaryKey);
        const loc = locale ?? initiator.credentials.locale;
        if (detail.busy) throw new HttpError(409, text(loc, "busy"), "WORKSPACE_BUSY");
        return {
          summary: text(loc, "syncImpact", { name: detail.name }),
          total: 1,
          objects: [{ target: appRef(primaryKey), label: detail.name }],
        };
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const result = await syncApplicationBuilderSource(executor.owner, executor.credentials, primaryKey);
        return success(primaryKey, result);
      });
    },
  },
  {
    ...appFormSaveBase,
    handlerRef: APPLICATION_PUBLISH_BUILDER_SOURCE,
    binding: binding(APPLICATION_PUBLISH_BUILDER_SOURCE),
    labelKey: "panels.appBuilder.publish",
    resultSchema: publicationResult,
    async unavailable(host, target) {
      if (!target) return;
      const locale = host.locale ?? host.initiator.credentials.locale;
      const detail = await getBuilderProject(host.initiator.owner, host.initiator.credentials, target.primaryKey);
      if (detail.busy) return { reason: text(locale, "busy") };
      if (!detail.materialized) return { reason: text(locale, "notMaterialized") };
      if (detail.drift.hasDrift) return { reason: text(locale, "driftBlocking") };
      if (detail.hasConflicts) return { reason: text(locale, "conflictsBlocking") };
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const body = builderPublishFieldsSchema.parse(draftInput(input));
        const release = await publishApplicationBuilderSource(executor.owner, executor.credentials, primaryKey, body);
        return success(primaryKey, release);
      });
    },
  },
  {
    ...appActionBase,
    handlerRef: APPLICATION_ROLLBACK_BUILDER_RELEASE,
    binding: binding(APPLICATION_ROLLBACK_BUILDER_RELEASE),
    labelKey: "panels.appBuilder.rollbackRelease",
    inputSchema: releaseInput,
    resultSchema: publicationResult,
    async unavailableForInput(host, target, input) {
      if (!target) return;
      const locale = host.locale ?? host.initiator.credentials.locale;
      const detail = await getBuilderProject(host.initiator.owner, host.initiator.credentials, target.primaryKey);
      if (detail.busy) return { reason: text(locale, "busy") };
      if (detail.drift.hasDrift) return { reason: text(locale, "driftBlocking") };
      if (detail.currentReleaseId && input.releaseId === detail.currentReleaseId) {
        return { reason: text(locale, "currentRelease") };
      }
    },
    async unavailableBatch(host, targets) {
      const locale = host.locale ?? host.initiator.credentials.locale;
      const details = new Map(await Promise.all([...new Set(targets.map(({ target }) => target.primaryKey))].map(async primaryKey => [
        primaryKey,
        await getBuilderProject(host.initiator.owner, host.initiator.credentials, primaryKey),
      ] as const)));
      const reasons = new Map<string, { reason: string }>();
      for (const { rowKey, target, row } of targets) {
        const detail = details.get(target.primaryKey)!;
        if (detail.busy) reasons.set(rowKey, { reason: text(locale, "busy") });
        else if (detail.drift.hasDrift) reasons.set(rowKey, { reason: text(locale, "driftBlocking") });
        else if (detail.currentReleaseId && row!.primaryKey === detail.currentReleaseId) {
          reasons.set(rowKey, { reason: text(locale, "currentRelease") });
        }
      }
      return reasons;
    },
    inspectImpact: {
      handlerRef: `${APPLICATION_ROLLBACK_BUILDER_RELEASE}.inspect-impact`,
      async inspect({ initiator, locale }, [call]) {
        const { primaryKey } = appTarget.parse(call.target);
        const { releaseId } = releaseInput.parse(call.input);
        const loc = locale ?? initiator.credentials.locale;
        const [detail, releases] = await Promise.all([
          getBuilderProject(initiator.owner, initiator.credentials, primaryKey),
          listApplicationBuilderReleases(initiator.owner, initiator.credentials, primaryKey),
        ]);
        if (detail.busy) throw new HttpError(409, text(loc, "busy"), "WORKSPACE_BUSY");
        if (detail.drift.hasDrift) throw new HttpError(409, text(loc, "driftBlocking"), "APPLICATION_SOURCE_DRIFT");
        if (detail.currentReleaseId === releaseId) throw new HttpError(409, text(loc, "currentRelease"), "CURRENT_RELEASE");
        const targetRelease = releases.find(r => r.id === releaseId);
        if (!targetRelease) throw new HttpError(404, text(loc, "releaseMissing"), "NOT_FOUND");
        return {
          summary: text(loc, "rollbackImpact", { name: detail.name, commit: targetRelease.commitId.slice(0, 7) }),
          total: 1,
          objects: [{ target: appRef(primaryKey), label: detail.name }],
        };
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const { releaseId } = releaseInput.parse(input);
        const release = await rollbackApplicationBuilderRelease(executor.owner, executor.credentials, primaryKey, releaseId);
        return success(primaryKey, release);
      });
    },
  },
  {
    ...appActionBase,
    handlerRef: APPLICATION_RESTART_BUILD_TEST,
    binding: binding(APPLICATION_RESTART_BUILD_TEST),
    labelKey: "panels.appBuilder.restartBuildTest",
    inputSchema: empty,
    resultSchema: empty,
    async unavailable(host, target) {
      if (!target) return;
      const locale = host.locale ?? host.initiator.credentials.locale;
      const ctx = await authorizeBuilderProject(host.initiator.owner, host.initiator.credentials, target.primaryKey, { skipLiveRead: true });
      if (!ctx.project) return { reason: text(locale, "restartUnavailable") };
      const test = await new WorkspaceBuildTests(
        host.initiator.owner,
        host.initiator.credentials,
        ctx.project.workspaceId,
        appWorkspaceSlot(target.primaryKey),
      ).current();
      if (!test || (test.status !== "EXPIRED" && test.status !== "CLOSED") || !test.sampleSummary?.name) {
        return { reason: text(locale, "restartUnavailable") };
      }
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget) {
      return execute(async () => {
        const { primaryKey } = appTarget.parse(target);
        const ctx = await authorizeBuilderProject(executor.owner, executor.credentials, primaryKey, { skipLiveRead: true });
        const locale = executor.credentials.locale;
        if (!ctx.project) {
          throw new HttpError(409, text(locale, "restartUnavailable"), "BUILD_TEST_RESTART_UNAVAILABLE");
        }
        const tests = new WorkspaceBuildTests(
          executor.owner,
          executor.credentials,
          ctx.project.workspaceId,
          appWorkspaceSlot(primaryKey),
        );
        const current = await tests.current();
        if (!current || (current.status !== "EXPIRED" && current.status !== "CLOSED") || !current.sampleSummary?.name) {
          throw new HttpError(409, text(locale, "restartUnavailable"), "BUILD_TEST_RESTART_UNAVAILABLE");
        }
        await tests.start(current.sampleSummary.name);
        return success(primaryKey);
      });
    },
  },
] as const satisfies readonly PanelWriteServerOperation[];
