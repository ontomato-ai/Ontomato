import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.resolve("vite"));
const { parseAst } = require("rollup/parseAst");

function measure(root) {
  const { version } = JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
  const directory = join(root, version);
  const files = new Map();

  function visit(file) {
    if (files.has(file)) return;
    const source = readFileSync(file);
    files.set(file, { bytes: source.length, gzipBytes: gzipSync(source).length });
    for (const node of parseAst(source.toString("utf8")).body) {
      if (node.source?.type === "Literal") visit(resolve(dirname(file), node.source.value));
    }
  }

  visit(join(directory, "panel.js"));
  const totals = { files: files.size, bytes: 0, gzipBytes: 0 };
  for (const { bytes, gzipBytes } of files.values()) {
    totals.bytes += bytes;
    totals.gzipBytes += gzipBytes;
  }
  return { root, version, ...totals };
}

const roots = process.argv.slice(2);
if (roots.length === 0) throw new Error("Usage: node measure-panel.mjs <sdk-output-root> [...]");
console.log(JSON.stringify(roots.map(root => measure(resolve(root))), null, 2));
