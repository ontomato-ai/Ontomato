#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analystCommand } from "./client.mjs";
const dir = path.dirname(fileURLToPath(import.meta.url)),
  cfg = {};
try {
  for (const line of fs
    .readFileSync(path.join(dir, "application.yml"), "utf8")
    .split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const at = text.indexOf(":");
    if (at < 0) throw new Error("application.yml requires key: value lines");
    cfg[text.slice(0, at).trim()] = text.slice(at + 1).trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const [env, key] of Object.entries({
  ONTOMATO_URL: "envUrl",
  ONTOMATO_ONTOLOGY_URL: "ontologyUrl",
  ONTOMATO_TK: "tk",
}))
  if (process.env[env] !== undefined) cfg[key] = process.env[env];
const command = process.argv[2];
const token =
  command === "ask" ? cfg.tk : (process.env.ONTOMATO_QUERY_TK ?? cfg.tk);
const headers = {
  ...(process.env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": process.env.ONTOMATO_SESSION_ID } : {}),
  ...(token ? { tk: token } : {}),
  ...(process.env.ONTOMATO_API_KEY ? { "X-API-Key": process.env.ONTOMATO_API_KEY } : {}),
  "Accept-Language": process.env.ONTOMATO_LANGUAGE ?? "en",
  ...(process.env.ONTOMATO_RUN_ID
    ? { "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID }
    : {}),
  ...(process.env.ONTOMATO_CORRELATION_ID
    ? { "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID }
    : {}),
};
analystCommand(cfg, process.argv.slice(2), headers).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
