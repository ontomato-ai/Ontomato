import { panelReadParameterSchemas as paramsSchema } from "@ontomato/contracts/panel-projection";
import { APPLICATION } from "@ontomato/contracts/platform-object-types";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AssistantOwner } from "../assistant/store";
import type { PreparedOwnerReadFacts } from "../product-panels/java-panel-reads";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import { ownerFactsRegistration, type RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { ApplicationBuilderReadAdapter, sourceCommitPage } from "./application-panel-reads";
import {
  prepareBuilderProjectFacts, readBuilderSourceCommits, readBuilderSourceDiff, readBuilderSourceFile, readBuilderSourceFiles,
  readBuilderSourceReleases,
} from "./project-service";

export async function prepareBuilderSourceFacts(
  owner: AssistantOwner, credentials: AssistantCredentials, selection: PanelReadSelection, params: Record<string, unknown>,
): Promise<PreparedOwnerReadFacts | undefined> {
  if (selection.typeId !== APPLICATION) return;
  const { method, primaryKey } = selection;
  if (!["sourceFiles", "sourceFile", "sourceDiff", "sourceCommits", "sourceReleases"].includes(method)) return;
  const appId = primaryKey!;
  const adapter = new ApplicationBuilderReadAdapter(owner, credentials);
  const project = await prepareBuilderProjectFacts(owner, appId, { live: method === "sourceFiles" || method === "sourceFile" });

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
          return adapter.presentSourceCommits(await readBuilderSourceCommits(ctx, offset, limit), offset);
        }
        case "sourceReleases":
          return adapter.presentSourceReleases(await readBuilderSourceReleases(owner.domainId, ctx));
      }
    },
  };
}

export const applicationBuilderSourceDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["sourceFiles", "sourceFile", "sourceCommits", "sourceDiff", "sourceReleases"] as const).map(method =>
    ownerFactsRegistration(APPLICATION, method, ({ owner, credentials, selection, params }) =>
      prepareBuilderSourceFacts(owner, credentials, selection, params))),
];
