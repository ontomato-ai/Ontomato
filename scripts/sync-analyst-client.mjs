// Distribute the public client source into standalone edition skill packages.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const source = fileURLToPath(
  new URL("../agent-skills/ontomato-analyst/client.mjs", import.meta.url),
);
for (const directory of process.argv.slice(2))
  copyFileSync(source, path.join(directory, "client.mjs"));
