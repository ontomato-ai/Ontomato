// Distribute the exact standard analyst package into standalone edition packages.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const source = fileURLToPath(
  new URL("../agent-skills/ontomato-analyst/", import.meta.url),
);
for (const directory of process.argv.slice(2)) {
  for (const name of path.basename(directory) === "ontomato-analyst"
    ? [
        "ontomato.mjs",
        "client.mjs",
        "SKILL.md",
        "python/query_runtime.py",
        "references/dsl.md",
      ]
    : ["client.mjs"]) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    copyFileSync(path.join(source, name), path.join(directory, name));
  }
}
