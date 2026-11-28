import fs from "fs";
import path from "path";
import { runtimeDataDir, runtimeResourceSources } from "../content/layout";
import { createLogger } from "../logging/logger";
import { tApp } from "../i18n";

const logger = createLogger("runtime-defaults");

/** Copies app-assembled runtime defaults into the persistent runtime data directory. */
export async function syncRuntimeDefaultResources(): Promise<void> {
  const runtimeRoot = runtimeDataDir();
  for (const { from, to } of runtimeResourceSources()) {
    const target = path.join(runtimeRoot, to);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.cp(from, target, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  logger.info(tApp("foundation.log.resources.synced"), { runtimeRoot });
}
