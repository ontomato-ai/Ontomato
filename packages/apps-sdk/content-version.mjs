import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

export const VERSION_PLACEHOLDER = "__APPS_SDK_VERSION__";

/** Text output is served compressed; binary assets are left as they are. */
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".json", ".md", ".html", ".svg", ".txt"]);

function files(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(root, name) : [name];
  }).sort();
}

// Hash the actual output before inserting its own version into docs, examples and manifests.
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
  for (const name of names.filter((name) => name === "sdk.json" || name === "components.json" ||
    name.startsWith("docs/") || name.startsWith("examples/"))) {
    const file = join(staged, name);
    writeFileSync(file, readFileSync(file, "utf8").replaceAll(VERSION_PLACEHOLDER, version));
  }
  renameSync(staged, join(root, version));
  // Compression artifacts are delivery-only: they are written after the content hash above, so the same
  // output always names the same version however it is compressed.
  for (const name of names) {
    if (!COMPRESSIBLE.has(extname(name))) continue;
    const bytes = readFileSync(join(root, version, name));
    writeFileSync(join(root, version, `${name}.br`), brotliCompressSync(bytes));
    writeFileSync(join(root, version, `${name}.gz`), gzipSync(bytes, { level: 9 }));
  }
  writeFileSync(join(root, "current.json"), JSON.stringify({ version }) + "\n");
  return version;
}
