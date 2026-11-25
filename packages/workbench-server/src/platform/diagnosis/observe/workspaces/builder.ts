import type { WorkspaceManifest } from "@ontomato/contracts/observe";
import { parseTurnKey } from "../../../../logging/log-context";
import { getWorkspacePath, loadManifest } from "./store";
import { buildTurnEvidenceWorkspace } from "./turn-evidence-workspace";
import { HttpError } from "../../../../utils/errors";

export interface BuildTurnWorkspaceOptions {
  turnKey: string; domainId: string; userId?: string; token?: string; apiKey?: string; signal?: AbortSignal;
}

const activeBuilds = new Map<string, {
  manifest: WorkspaceManifest;
  result: Promise<WorkspaceManifest>;
}>();

export function getCollectingTurnWorkspace(turnKey: string): WorkspaceManifest | undefined {
  return activeBuilds.get(turnKey)?.manifest;
}

export function listCollectingTurnWorkspaces(): WorkspaceManifest[] {
  return Array.from(activeBuilds.values(), (build) => build.manifest);
}

export async function buildTurnWorkspace(options: BuildTurnWorkspaceOptions) {
  const { turnKey, domainId } = options;
  const turn = parseTurnKey(turnKey);
  if (!turn) throw new HttpError(400, "Invalid turnKey");
  const active = activeBuilds.get(turnKey);
  if (active) {
    if (active.manifest.domainId !== domainId) throw new HttpError(404, "Turn not found");
    return active.result;
  }
  const existing = loadManifest(turnKey);
  if (existing && existing.domainId !== domainId) throw new HttpError(404, "Turn not found");

  const manifest: WorkspaceManifest = {
    domainId,
    workspaceId: turnKey,
    turnKey,
    requestSeq: turn.requestSeq,
    status: "collecting",
    createdAt: new Date().toISOString(),
    source: "manual",
    question: existing?.question,
  };
  // Register before invoking the reader and retain the entry through the final manifest write.
  const result = Promise.resolve().then(async () => {
    const built = await buildTurnEvidenceWorkspace({
      ...options,
      workspaceId: turnKey,
      artifactDir: getWorkspacePath(turnKey),
      metadata: { targetId: turnKey, source: "manual" },
    });
    return built.manifest;
  }).finally(() => {
    activeBuilds.delete(turnKey);
  });
  activeBuilds.set(turnKey, { manifest, result });
  return result;
}
