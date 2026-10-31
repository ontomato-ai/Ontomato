import fs from "node:fs";
import path from "node:path";
import type { WorkspaceManifest, WorkspaceSource } from "@ontomato/contracts/observe";
import { diagnosisEvidenceReader } from "./diagnosis-source";
import { parseTurnKey } from "../../../../logging/log-context";

export interface BuildTurnEvidenceWorkspaceInput {
  workspaceId: string; domainId: string; turnKey: string; artifactDir: string;
  token?: string; apiKey?: string; userId?: string; signal?: AbortSignal;
  metadata: { targetId: string; source: WorkspaceSource; question?: string; finalAnswer?: string;
    runId?: string; caseId?: string; threadId?: string; durationMs?: number; error?: string };
}
export interface WorkspaceArtifactResult { artifactDir: string; manifest: WorkspaceManifest; logicMarkdown: string }
/** A case keeps source references; reading logs or runtime messages never writes a second archive. */
export async function buildTurnEvidenceWorkspace(input: BuildTurnEvidenceWorkspaceInput) {
  input.signal?.throwIfAborted();
  const evidence = await diagnosisEvidenceReader().resolve({ kind: "turn", turnKey: input.turnKey }, {
    domainId: input.domainId, userId: input.userId ?? "", token: input.token, apiKey: input.apiKey,
  });
  input.signal?.throwIfAborted();
  if (input.metadata.source === "autotest" && input.metadata.runId && input.metadata.caseId)
    evidence.target = { kind: "autotest-case", testRunId: input.metadata.runId, caseId: input.metadata.caseId };
  const turn = parseTurnKey(input.turnKey)!;
  const manifest: WorkspaceManifest = {
    domainId: input.domainId, workspaceId: input.workspaceId, turnKey: input.turnKey,
    requestSeq: turn.requestSeq, status: "completed", createdAt: evidence.resolvedAt, completedAt: evidence.resolvedAt,
    source: input.metadata.source, runId: input.metadata.runId, caseId: input.metadata.caseId,
    durationMs: input.metadata.durationMs, evidence,
  };
  fs.mkdirSync(input.artifactDir, { recursive: true });
  const file = path.join(input.artifactDir, "manifest.json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(manifest, null, 2));
  fs.renameSync(file + ".tmp", file);
  const artifactResult: WorkspaceArtifactResult = { artifactDir: input.artifactDir, manifest, logicMarkdown: "" };
  return { status: evidence.gaps.length ? "degraded" as const : "success" as const, manifest, artifactResult, reason: evidence.gaps.map((g) => g.message).join("\n") };
}
