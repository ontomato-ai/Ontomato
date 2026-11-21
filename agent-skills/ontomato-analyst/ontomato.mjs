#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analystCommand } from "./client.mjs";
const argv = process.argv.slice(2);
const platformAgent = argv[0] === "agent" && process.env.ONTOMATO_SKILL_SCENARIO === "platform";
const dir = path.dirname(fileURLToPath(import.meta.url)),
  cfg = {};
if (!platformAgent) try {
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
if (!platformAgent) for (const [env, key] of Object.entries({
  ONTOMATO_URL: "envUrl",
  ONTOMATO_ONTOLOGY_URL: "ontologyUrl",
  ONTOMATO_TK: "tk",
}))
  if (process.env[env] !== undefined) cfg[key] = process.env[env];
const token = cfg.tk;
const headers = platformAgent ? {} : {
  ...(process.env.ONTOMATO_EXECUTION_CALLBACK ? { "X-Ontomato-Callback-Credential": process.env.ONTOMATO_EXECUTION_CALLBACK, "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID } : {}),
  ...(process.env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": process.env.ONTOMATO_SESSION_ID } : {}),
  ...(process.env.ONTOMATO_RETRIEVAL_CALLER_ID ? { "X-Ontomato-Retrieval-Caller-Id": process.env.ONTOMATO_RETRIEVAL_CALLER_ID } : {}),
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
analystCommand(cfg, argv, headers).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
