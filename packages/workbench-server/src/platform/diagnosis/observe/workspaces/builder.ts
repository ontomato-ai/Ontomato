import type {
  WorkspaceManifest,
  WorkspaceSource,
} from "@ontomato/contracts/observe";
/**
 * Turn workspace creation and building.
 *
 * All turns take the same build path. Whether one run consists of sub-turns is answered by the business domain owning the run;
 * the build capability only receives the sub-turn list, knowing nothing about dimensions or trajectories.
 */

import { createLogger } from "../../../../logging/logger";
import { getWorkspacePath, loadManifest } from "./store";
import { assistantEvidenceReader } from "./assistant-source";
import { parseTurnKeyOrThrow } from "./turn-resolver";
import { buildTurnEvidenceWorkspace } from "./turn-evidence-workspace";

const logger = createLogger("observe:turn-workspace-builder");

export interface BuildTurnWorkspaceOptions {
  turnKey: string;
  domainId: string;
  token?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

/**
 * Create a Turn workspace: collect logs, parse them, run post-processing,
 * and persist everything to the observe workspace.
 *
 * @returns The final manifest after building.
 */
export async function buildTurnWorkspace(
  options: BuildTurnWorkspaceOptions,
): Promise<WorkspaceManifest> {
  const { turnKey, token, apiKey, domainId } = options;
  options.signal?.throwIfAborted();
  await assistantEvidenceReader().verifyDomain(
    parseTurnKeyOrThrow(turnKey).threadId,
    domainId,
  );
  const existing = loadManifest(turnKey);
  if (existing && existing.domainId !== domainId)
    throw new Error("Workspace domain does not match the credential");
  const workspaceId = turnKey;
  logger.info("Starting turn workspace build", { turnKey });

  try {
    const result = await buildTurnEvidenceWorkspace({
      workspaceId,
      domainId,
      turnKey,
      artifactDir: getWorkspacePath(workspaceId),
      metadata: {
        targetId: turnKey,
        source: "manual",
        threadId: parseTurnKeyOrThrow(turnKey).threadId,
      },
      token,
      apiKey,
      signal: options.signal,
    });

    const manifest = result.manifest;

    logger.info("Turn workspace build finished", {
      turnKey,
      status: result.status,
      appLogCount: manifest.appLogCount,
      llmCallCount: manifest.llmCallCount,
      backendLogCount: manifest.backendLogCount,
      errorCount: manifest.errorCount,
    });

    return manifest;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Turn workspace build failed", { turnKey, error: msg });
    return { ...failedManifest(workspaceId, msg, "manual", turnKey), domainId };
  }
}

function failedManifest(
  workspaceId: string,
  error: string,
  source: WorkspaceSource = "manual",
  turnKey?: string,
): WorkspaceManifest {
  const now = new Date().toISOString();
  return {
    workspaceId,
    ...(turnKey ? { turnKey } : {}),
    status: "failed",
    source,
    createdAt: now,
    completedAt: now,
    appLogCount: 0,
    llmCallCount: 0,
    backendLogCount: 0,
    errorCount: 0,
    error,
  };
}
