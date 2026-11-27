import { panelReadParameterSchemas as paramsSchema, type PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  APPLICATION, APPLICATION_RESTORE_SOURCE_COMMIT, APPLICATION_ROLLBACK_BUILDER_RELEASE,
} from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AssistantOwner } from "../assistant/store";
import { fixedRowOperationTarget, presentRowOperationsForRows, resolvePinnedBoundParams } from "../product-panels/direct-operations";
import type { PreparedOwnerReadFacts } from "../product-panels/java-panel-reads";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { withReadDirective } from "../product-panels/read-directive";
import { ApplicationBuilderReadAdapter, sourceCommitPage } from "./application-panel-reads";
import {
  builderRestoreBlock, builderRollbackBlock, prepareBuilderProjectFacts, readBuilderProjectDrift, readBuilderProjectStatus,
  readBuilderSourceCommits, readBuilderSourceDiff, readBuilderSourceFile, readBuilderSourceFiles, readBuilderSourceReleases,
} from "./project-service";

function builderRowBindings(projection: ProductProjection, inputs: Readonly<Record<string, unknown>>, appId: string, operationId: string) {
  return Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) => {
    if (operation.kind !== "PlatformOperation" || operation.id !== operationId || !target
      || (!("input" in target) && !("literal" in target))) return false;
    const selected = fixedRowOperationTarget(target, inputs);
    return selected?.objectType === APPLICATION && selected.primaryKey === appId;
  }));
}

export async function prepareBuilderSourceFacts(
  owner: AssistantOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
  projection: ProductProjection, inputs: Readonly<Record<string, unknown>>,
): Promise<PreparedOwnerReadFacts | undefined> {
  if (selection.typeId !== APPLICATION) return;
  const { method, primaryKey } = selection;
  if (!["sourceFiles", "sourceFile", "sourceDiff", "sourceCommits", "sourceReleases"].includes(method)) return;
  const appId = primaryKey!;
  const adapter = new ApplicationBuilderReadAdapter(owner, credentials);
  const operationId = method === "sourceCommits" ? APPLICATION_RESTORE_SOURCE_COMMIT
    : method === "sourceReleases" ? APPLICATION_ROLLBACK_BUILDER_RELEASE : undefined;
  const operations = operationId ? builderRowBindings(projection, inputs, appId, operationId) : {};
  const describeRows = Object.keys(operations).length > 0;
  const rollback = method === "sourceReleases" && describeRows;
  const project = await prepareBuilderProjectFacts(owner, appId, {
    live: method === "sourceFiles" || method === "sourceFile" || rollback,
  });

  async function withRows<T>(
    value: T, rows: readonly PanelRecord[], reason: (input: Readonly<Record<string, unknown>>) => string | undefined,
  ) {
    if (!describeRows) return value;
    const known = new Map(Object.entries(inputs));
    const rowOperations = await presentRowOperationsForRows(
      { ...projection, operations }, inputs, rows, APPLICATION, (_handler, binding, targets) =>
        new Map(targets.map(({ rowKey, row, target }) => {
          const key = reason(resolvePinnedBoundParams(binding, known, target, row));
          return [rowKey, key ? { reason: adapter.text(key) } : undefined];
        })),
    );
    return rowOperations ? withReadDirective(value, { rowOperations }) : value;
  }

  return {
    facts: project.facts,
    async present(_viewer, results) {
      const ctx = await project.context(results);
      switch (method) {
        case "sourceFiles": {
          const commit = paramsSchema.workspaceCommit.optional().parse(params.commit);
          return adapter.presentSourceFiles(await readBuilderSourceFiles(ctx, commit));
        }
        case "sourceFile": {
          const path = paramsSchema.workspacePath.parse(params.path);
          const commit = paramsSchema.workspaceCommit.optional().parse(params.commit);
          return adapter.presentSourceFile(await readBuilderSourceFile(ctx, path, commit));
        }
        case "sourceDiff": {
          const target = paramsSchema.workspaceDiffTarget.optional().parse(params.target) ?? "latest";
          return adapter.presentSourceDiff(appId, await readBuilderSourceDiff(ctx, target));
        }
        case "sourceCommits": {
          const { offset, limit } = sourceCommitPage(params);
          const page = await readBuilderSourceCommits(ctx, offset, limit);
          const value = adapter.presentSourceCommits(page, offset);
          const state = { materialized: ctx.project !== null, busy: page.busy, headCommit: page.headCommit };
          return withRows(value, value.rows, input => builderRestoreBlock(state, input.commit));
        }
        case "sourceReleases": {
          const releases = await readBuilderSourceReleases(owner.domainId, ctx);
          const rows = adapter.presentSourceReleases(releases);
          if (!rollback || !rows.length) return rows;
          // The original rollback description uses project detail, which also requires query admission.
              const { busy } = await readBuilderProjectStatus(ctx, credentials.locale);
          const state = { busy, drift: readBuilderProjectDrift(ctx, credentials.locale),
            currentReleaseId: ctx.published && ctx.project ? releases[0]?.id ?? null : null };
          return withRows(rows, rows, input => builderRollbackBlock(state, input.releaseId));
        }
      }
    },
  };
}
