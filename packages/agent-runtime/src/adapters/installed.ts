import { codexPlugin } from "./codex";
import { piPlugin } from "./pi";
import { HarnessRegistry } from "./registry";

export const installedHarnesses = new HarnessRegistry([piPlugin, codexPlugin]);
