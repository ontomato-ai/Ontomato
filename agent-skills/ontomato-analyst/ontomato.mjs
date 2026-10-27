#!/usr/bin/env node
import fs from "node:fs";
import { analystCommand } from "./client.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
  const text = fs.readFileSync(path.join(DIR, "application.yml"), "utf8");
  const cfg = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) die(`application.yml line is not key: value: ${trimmed}`);
    cfg[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  if (process.env.ONTOMATO_URL) cfg.envUrl = process.env.ONTOMATO_URL;
  return cfg;
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.envUrl)
    throw new Error("Set ONTOMATO_URL or envUrl in application.yml");
  await analystCommand(cfg, process.argv.slice(2));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
