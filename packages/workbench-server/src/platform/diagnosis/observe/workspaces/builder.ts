import { getWorkspacePath, loadManifest } from "./store";
import { buildTurnEvidenceWorkspace } from "./turn-evidence-workspace";
import { HttpError } from "../../../../utils/errors";

export interface BuildTurnWorkspaceOptions {
  turnKey: string; domainId: string; userId?: string; token?: string; apiKey?: string; signal?: AbortSignal;
}
export async function buildTurnWorkspace(options: BuildTurnWorkspaceOptions) {
  const existing = loadManifest(options.turnKey);
  if (existing && existing.domainId !== options.domainId) throw new HttpError(404, "Turn not found");
  return (await buildTurnEvidenceWorkspace({
    ...options, workspaceId: options.turnKey, artifactDir: getWorkspacePath(options.turnKey),
    metadata: { targetId: options.turnKey, source: "manual" },
  })).manifest;
}
