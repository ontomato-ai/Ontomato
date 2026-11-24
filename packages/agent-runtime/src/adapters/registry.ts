import type { HarnessEngineId, HarnessPlugin } from "./contract";
import { RuntimeError } from "../errors";

export const defaultEngineId = "pi";

/**
 * The installed execution engines, by id. The process assembles them at startup; a session's stored engine
 * id is looked up here every time that session runs.
 */
export class HarnessRegistry {
  private readonly plugins: ReadonlyMap<HarnessEngineId, HarnessPlugin>;
  constructor(plugins: readonly HarnessPlugin[]) {
    this.plugins = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  }
  /** An uninstalled engine is a configuration error the caller can fix, not a missing session. */
  get(id: HarnessEngineId): HarnessPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin)
      throw new RuntimeError(422, "ENGINE_NOT_REGISTERED", `Execution engine ${id} is not installed in this deployment`);
    return plugin;
  }
  ids(): HarnessEngineId[] {
    return [...this.plugins.keys()];
  }
}
