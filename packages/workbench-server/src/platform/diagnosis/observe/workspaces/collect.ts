import fs from "node:fs";
import { buildTurnWorkspace } from "./builder";
import { deleteWorkspace, getWorkspacePath, loadManifest } from "./store";
import { parseTurnKeyOrThrow } from "./turn-resolver";
import { getCheckpointer } from "../../../../infrastructure/connection";
import { tApp } from "../../../../i18n";

/** Shared diagnosis operation; AgentTool and governance HTTP are only callers. */
export async function collectTurnArtifacts(
  caller: { domainId: string; token?: string; apiKey?: string },
  turnKey: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (!turnKey.trim())
    return tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.3");
  try {
    const checkpointer = getCheckpointer();
    if (!checkpointer) throw new Error("Thread storage unavailable");
    await checkpointer.verifyThreadDomain(
      parseTurnKeyOrThrow(turnKey).threadId,
      caller.domainId,
    );
    const existing = loadManifest(turnKey);
    if (existing && existing.domainId !== caller.domainId)
      throw new Error("Workspace domain does not match the credential");
    signal?.throwIfAborted();
    const workspacePath = getWorkspacePath(turnKey);
    if (fs.existsSync(workspacePath) && !deleteWorkspace(turnKey))
      return tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.4");
    const manifest = await buildTurnWorkspace({ turnKey, ...caller, signal });
    signal?.throwIfAborted();
    if (manifest.status === "failed")
      return tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.5", {
        p0:
          manifest.error ||
          tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.6"),
      });
    if (manifest.status !== "completed")
      return tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.7", {
        p0: manifest.status,
      });
    return workspacePath;
  } catch (error) {
    return tApp("diag.observe.agent.tools.collect-turn-artifacts-tool.5", {
      p0: error instanceof Error ? error.message : String(error),
    });
  }
}
