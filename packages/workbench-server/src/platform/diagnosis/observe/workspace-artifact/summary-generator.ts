import fs from "node:fs";
import path from "node:path";
import { ARTIFACT_DIRS } from "./utils";
export type WorkspaceArtifactSource = "autotest" | "manual" | "analysis-task";

export interface WorkspaceArtifactSummaryMetadata {
  targetId: string;
  source: WorkspaceArtifactSource;
  question?: string;
  finalAnswer?: string;
  runId?: string;
  caseId?: string;
  threadId?: string;
  durationMs?: number;
  error?: string;
}


export function generateSummary(input: { artifactDir: string; metadata: WorkspaceArtifactSummaryMetadata; logicMarkdown?: string }): void {
  const directory = path.join(input.artifactDir, ARTIFACT_DIRS.DIAGNOSTICS);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "summary.md"), [
    "# Diagnostic evidence", "", input.metadata.question ?? "",
    "", "Service log query references: ../service-log-queries.json.",
    "Model messages and artifacts are owned by the runtime; service logs do not contain their payloads.",
  ].join("\n"));
}
