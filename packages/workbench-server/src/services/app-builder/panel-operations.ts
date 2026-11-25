import { z } from "zod";
import { domainApplicationIconSchema } from "@ontomato/contracts/application-icons";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import {
  APPLICATION, APP_WORKSPACE, APP_WORKSPACE_CREATE, APP_WORKSPACE_DELETE, APP_WORKSPACE_PUBLISH,
  APP_WORKSPACE_RESTART_BUILD_TEST, APP_WORKSPACE_RESTORE_COMMIT, APP_WORKSPACE_ROLLBACK_RELEASE,
  APP_WORKSPACE_SAVE, APP_WORKSPACE_UPDATE_PUBLISHED_ICON,
} from "@ontomato/contracts/platform-object-types";
import type { ApplicationDeclaration } from "@ontomato/contracts/platform-identity";
import { workspaceIdSchema, workspaceNameSchema, workspaceRestoreSchema, workspaceSchema } from "@ontomato/contracts/workspaces";
import { buildUrl, getApiConfig } from "../../config/data-query-api";
import { supportedLocales } from "../../i18n";
import { backendPut } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { PanelOperationActor, PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelWriteServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";
import { assertAppBuilderAccess } from "./access";
import { AppWorkspaceOwner, catalogDeclaration, publicationFields, restartSample } from "./panel-reads";

const objectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(APP_WORKSPACE), primaryKey: workspaceIdSchema,
}).strict();
const empty = z.object({}).strict();
const releaseInput = z.object({ releaseId: workspaceIdSchema }).strict();
const iconInput = publicationFields.pick({ icon: true });
const publicationResult = z.object({ appId: z.string(), releaseId: workspaceIdSchema, commit: workspaceRestoreSchema.shape.commit }).strict();
const binding = (id: string) => ({ kind: "PlatformOperation" as const, id });
const workspaceRef = (primaryKey: string) => ({ objectType: APP_WORKSPACE, primaryKey });
const ownerOf = ({ owner, credentials }: PanelOperationActor) => new AppWorkspaceOwner(owner, credentials);
const draftInput = (input: Record<string, unknown>) => panelFormSaveInputSchema.parse(input).values;
const action = {
  kind: "action", effect: "write", batch: false, targetType: APP_WORKSPACE, targetSchema: objectTarget,
  targetInput: "workspace",
  async targetLabel(host: PanelOperationHost, target: PanelRecordTarget) {
    return (await ownerOf(host.initiator).owned(target.primaryKey)).workspace.name;
  },
} as const;
const formSave = {
  kind: "form.save", effect: "write", batch: false, targetType: APP_WORKSPACE, targetSchema: objectTarget,
  inputSchema: panelFormSaveInputSchema, draftInput,
} as const;

function success(id: string, data: Record<string, string> = {}, appId?: string): SinglePanelOperationOutcome {
  return {
    kind: "success", data,
    affected: {
      objects: [workspaceRef(id), ...(appId ? [{ objectType: APPLICATION, primaryKey: appId }] : [])],
      objectTypes: appId ? [APP_WORKSPACE, APPLICATION] : [APP_WORKSPACE],
    },
  };
}

async function execute(run: () => Promise<SinglePanelOperationOutcome>): Promise<SinglePanelOperationOutcome> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError && error.status < 500)
      return { kind: "refusal", code: error.code ?? "INVALID_REQUEST", message: error.message };
    if (error instanceof z.ZodError)
      return { kind: "refusal", code: "INVALID_REQUEST", message: error.message };
    throw error;
  }
}

function block(owner: AppWorkspaceOwner, code: string, key: string): never {
  throw new HttpError(409, owner.text(key), code);
}

function checkIdle(owner: AppWorkspaceOwner, busy: boolean) {
  if (busy) block(owner, "WORKSPACE_BUSY", "busy");
}

async function busyReason(host: PanelOperationHost, target: PanelRecordTarget | null) {
  if (!target) return;
  const owner = ownerOf(host.initiator);
  const { workspace } = await owner.owned(target.primaryKey);
  if (workspace.activeRunId) return { reason: owner.text("busy") };
}

function impact(owner: AppWorkspaceOwner, id: string, name: string, summary: string, total = 1) {
  return { summary, total, objects: [{ target: workspaceRef(id), label: name }] };
}

export const appWorkspaceServerOperations = [
  {
    ...formSave, targetSchema: panelFormTargetSchema.options[1], create: true,
    handlerRef: APP_WORKSPACE_CREATE, binding: binding(APP_WORKSPACE_CREATE),
    labelKey: "panels.appWorkspace.create", resultSchema: z.object({ id: workspaceIdSchema }).strict(),
    async execute({ executor }: PanelOperationHost, _target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const owner = ownerOf(executor);
        await assertAppBuilderAccess(owner.credentials);
        const body = workspaceNameSchema.parse(draftInput(input));
        const { id } = workspaceSchema.parse(await owner.runtime.request("/v1/workspaces", "POST", body));
        return { ...success(id, { id }), created: workspaceRef(id) };
      });
    },
  },
  {
    ...formSave, handlerRef: APP_WORKSPACE_SAVE, binding: binding(APP_WORKSPACE_SAVE),
    labelKey: "panels.appWorkspace.save", resultSchema: empty,
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const owner = ownerOf(executor);
        await assertAppBuilderAccess(owner.credentials);
        await owner.runtime.request(owner.path(primaryKey), "PATCH", workspaceNameSchema.parse(draftInput(input)));
        return success(primaryKey);
      });
    },
  },
  {
    ...action, handlerRef: APP_WORKSPACE_DELETE, binding: binding(APP_WORKSPACE_DELETE),
    labelKey: "panels.appWorkspace.delete", inputSchema: empty, resultSchema: empty,
    unavailable: busyReason,
    inspectImpact: {
      handlerRef: `${APP_WORKSPACE_DELETE}.inspect-impact`,
      async inspect({ initiator }, [call]) {
        const { primaryKey } = objectTarget.parse(call.target);
        const owner = ownerOf(initiator);
        const { workspace } = await owner.owned(primaryKey);
        checkIdle(owner, workspace.activeRunId !== null);
        const count = (await owner.sessionsFor(primaryKey)).length;
        return impact(owner, primaryKey, workspace.name, owner.text("deleteImpact", { count, name: workspace.name }), count + 1);
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const owner = ownerOf(executor);
        const { workspace } = await owner.owned(primaryKey);
        checkIdle(owner, workspace.activeRunId !== null);
        await owner.tests(primaryKey).stop();
        const deleted = z.object({ sessionIds: z.array(workspaceIdSchema) }).parse(await owner.runtime.request(owner.path(primaryKey), "DELETE"));
        const { assistantService } = await import("../assistant/service");
        for (const id of deleted.sessionIds) await assistantService.delete(id, owner.owner);
        return {
          kind: "success", data: {},
          affected: { objects: [], objectTypes: [APP_WORKSPACE], removed: [workspaceRef(primaryKey)] },
        };
      });
    },
  },
  {
    ...action, handlerRef: APP_WORKSPACE_RESTORE_COMMIT, binding: binding(APP_WORKSPACE_RESTORE_COMMIT),
    labelKey: "panels.appWorkspace.restoreCommit", inputSchema: workspaceRestoreSchema, resultSchema: empty,
    async unavailableForInput(host, target, input) {
      if (!target) return;
      const owner = ownerOf(host.initiator);
      const { workspace } = await owner.owned(target.primaryKey);
      if (workspace.activeRunId) return { reason: owner.text("busy") };
      if (input.commit === workspace.headCommit) return { reason: owner.text("currentCommit") };
    },
    inspectImpact: {
      handlerRef: `${APP_WORKSPACE_RESTORE_COMMIT}.inspect-impact`,
      async inspect({ initiator }, [call]) {
        const { primaryKey } = objectTarget.parse(call.target);
        const { commit } = workspaceRestoreSchema.parse(call.input);
        const owner = ownerOf(initiator);
        const { workspace } = await owner.owned(primaryKey);
        checkIdle(owner, workspace.activeRunId !== null);
        if (commit === workspace.headCommit) block(owner, "CURRENT_COMMIT", "currentCommit");
        await owner.findCommit(primaryKey, commit);
        return impact(owner, primaryKey, workspace.name, owner.text("restoreImpact", { commit: commit.slice(0, 7), name: workspace.name }));
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const body = workspaceRestoreSchema.parse(input);
        const owner = ownerOf(executor);
        const { workspace } = await owner.owned(primaryKey);
        checkIdle(owner, workspace.activeRunId !== null);
        if (body.commit === workspace.headCommit) block(owner, "CURRENT_COMMIT", "currentCommit");
        await owner.runtime.request(`${owner.path(primaryKey)}/restore`, "POST", body);
        return success(primaryKey);
      });
    },
  },
  {
    ...action, handlerRef: APP_WORKSPACE_RESTART_BUILD_TEST, binding: binding(APP_WORKSPACE_RESTART_BUILD_TEST),
    labelKey: "panels.appWorkspace.restartBuildTest", inputSchema: empty, resultSchema: empty,
    async unavailable({ initiator }: PanelOperationHost, target: PanelRecordTarget | null) {
      if (!target) return;
      const owner = ownerOf(initiator);
      await assertAppBuilderAccess(owner.credentials);
      await owner.workspace(target.primaryKey);
      const test = await owner.tests(target.primaryKey).current().catch(() => null);
      if (!restartSample(test)) return { reason: owner.text("restartUnavailable") };
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const owner = ownerOf(executor);
        await assertAppBuilderAccess(owner.credentials);
        const tests = owner.tests(primaryKey);
        const sample = restartSample(await tests.current());
        if (!sample) block(owner, "BUILD_TEST_RESTART_UNAVAILABLE", "restartUnavailable");
        await tests.start(sample);
        return success(primaryKey);
      });
    },
  },
  {
    ...formSave, handlerRef: APP_WORKSPACE_PUBLISH, binding: binding(APP_WORKSPACE_PUBLISH),
    labelKey: "panels.appWorkspace.publish", resultSchema: publicationResult, unavailable: busyReason,
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const { name, icon, commit } = publicationFields.parse(draftInput(input));
        const owner = ownerOf(executor);
        const { workspace, catalog } = await owner.owned(primaryKey);
        checkIdle(owner, workspace.activeRunId !== null);
        const { application, current } = await owner.publication(primaryKey, catalog);
        const candidate = await owner.findCommit(primaryKey, commit);
        const reason = owner.publishBlock(candidate, current?.commit);
        if (reason) throw new HttpError(409, reason, "COMMIT_NOT_PUBLISHABLE");
        // Catalogued icons can outlive the palette. Validate an icon only when it changes.
        if (icon !== application?.icon) domainApplicationIconSchema.parse(icon);
        const declaration: ApplicationDeclaration = application ? { ...catalogDeclaration(application), icon } : {
          names: Object.fromEntries(supportedLocales().map(locale => [locale, workspaceNameSchema.shape.name.parse(name)])),
          descriptions: {}, icon, groups: [], permissions: [],
        };
        const { publishWorkspace } = await import("../workspaces/hosted-apps");
        const release = await publishWorkspace(owner.owner, primaryKey, commit, declaration, owner.credentials);
        return success(primaryKey, release, release.appId);
      });
    },
  },
  {
    ...action, handlerRef: APP_WORKSPACE_ROLLBACK_RELEASE, binding: binding(APP_WORKSPACE_ROLLBACK_RELEASE),
    labelKey: "panels.appWorkspace.rollbackRelease", inputSchema: releaseInput, resultSchema: publicationResult,
    async unavailableForInput(host, target, input) {
      if (!target) return;
      const owner = ownerOf(host.initiator);
      const { catalog } = await owner.owned(target.primaryKey);
      const { application, current } = await owner.publication(target.primaryKey, catalog);
      if (!application) return { reason: owner.text("publicationUnavailable") };
      if (current && input.releaseId === current.releaseId) return { reason: owner.text("currentRelease") };
    },
    inspectImpact: {
      handlerRef: `${APP_WORKSPACE_ROLLBACK_RELEASE}.inspect-impact`,
      async inspect({ initiator }, [call]) {
        const { primaryKey } = objectTarget.parse(call.target);
        const { releaseId } = releaseInput.parse(call.input);
        const owner = ownerOf(initiator);
        const { workspace, catalog } = await owner.owned(primaryKey);
        const { application, current, releases } = await owner.publication(primaryKey, catalog);
        if (!application) block(owner, "APPLICATION_UNAVAILABLE", "publicationUnavailable");
        if (releaseId === current?.releaseId) block(owner, "CURRENT_RELEASE", "currentRelease");
        const release = releases.find(item => item.releaseId === releaseId);
        if (!release) throw new HttpError(404, owner.text("releaseMissing"), "NOT_FOUND");
        return impact(owner, primaryKey, workspace.name, owner.text("rollbackImpact", { commit: release.commit.slice(0, 7), name: workspace.name }));
      },
    },
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const { releaseId } = releaseInput.parse(input);
        const owner = ownerOf(executor);
        const { catalog } = await owner.owned(primaryKey);
        const { application, current } = await owner.publication(primaryKey, catalog);
        if (!application) block(owner, "APPLICATION_UNAVAILABLE", "publicationUnavailable");
        if (releaseId === current?.releaseId) block(owner, "CURRENT_RELEASE", "currentRelease");
        const { rollbackWorkspace } = await import("../workspaces/hosted-apps");
        const { appId, commit } = await rollbackWorkspace(owner.owner, primaryKey, releaseId, catalogDeclaration(application), owner.credentials);
        return success(primaryKey, { appId, releaseId, commit }, appId);
      });
    },
  },
  {
    ...action, handlerRef: APP_WORKSPACE_UPDATE_PUBLISHED_ICON, binding: binding(APP_WORKSPACE_UPDATE_PUBLISHED_ICON),
    labelKey: "panels.appWorkspace.updatePublishedIcon", inputSchema: iconInput, resultSchema: empty,
    async execute({ executor }: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return execute(async () => {
        const { primaryKey } = objectTarget.parse(target);
        const body = iconInput.parse(input);
        const owner = ownerOf(executor);
        const { catalog } = await owner.owned(primaryKey);
        const { application } = await owner.publication(primaryKey, catalog);
        if (!application) block(owner, "APPLICATION_UNAVAILABLE", "publicationUnavailable");
        if (body.icon !== application.icon) domainApplicationIconSchema.parse(body.icon);
        const response = await backendPut(
          "app-workspace-icon", buildUrl(getApiConfig(), `/platform/applications/${encodeURIComponent(application.id)}/icon`),
          body, owner.credentials,
        );
        z.object({ success: z.literal(true) }).parse(JSON.parse(response.text));
        return success(primaryKey, {}, application.id);
      });
    },
  },
] as const satisfies readonly PanelWriteServerOperation[];
