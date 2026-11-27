import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skills = ["ontology-query", "data-retrieval", "ontology-generation", "metricview-generation"];
const importPattern = /(?:import|export)\s(?:[^'";]*?\sfrom\s)?["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/gu;

async function scriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await scriptFiles(full));
    else if (entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

test("built skill script outputs never import outside their own skill directory", async () => {
  for (const skill of skills) {
    const root = path.join(repoRoot, "agent-skills", skill);
    for (const file of await scriptFiles(root)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2];
        const target = path.resolve(path.dirname(file), specifier);
        assert.ok(target.startsWith(root + path.sep), `${skill}: ${path.relative(repoRoot, file)} imports outside the skill: ${specifier}`);
        assert.ok(existsSync(target) || existsSync(target + ".mjs"), `${skill}: missing local import ${specifier}`);
      }
    }
  }
});
