import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION_PLACEHOLDER = "__APPS_SDK_VERSION__";

function files(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, name) : [name];
  }).sort();
}

// Hash the actual output before inserting its own version into docs, examples and manifest.
// Framed paths and bytes include additions, removals and binary assets without ambiguity.
export function finalizeSdk(root, base, release) {
  const staged = join(root, VERSION_PLACEHOLDER);
  const names = files(staged);
  const hash = createHash("sha256");
  for (const name of names) {
    const bytes = readFileSync(join(staged, name));
    hash.update(JSON.stringify([name, bytes.length]) + "\n").update(bytes);
  }
  const version = release ? base : `${base}-dev.${hash.digest("hex")}`;
  for (const name of names.filter((name) => name === "sdk.json" || name.startsWith("docs/") || name.startsWith("examples/"))) {
    const file = join(staged, name);
    writeFileSync(file, readFileSync(file, "utf8").replaceAll(VERSION_PLACEHOLDER, version));
  }
  renameSync(staged, join(root, version));
  writeFileSync(join(root, "current.json"), JSON.stringify({ version }) + "\n");
  return version;
}
