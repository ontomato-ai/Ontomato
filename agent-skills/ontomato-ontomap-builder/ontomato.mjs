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

function readInput(arg) {
  if (arg.startsWith("@")) return fs.readFileSync(arg.slice(1), "utf8");
  return arg;
}

async function request(cfg, method, backendPath, body, headers) {
  const h = { ...headers };
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return fetch(`${cfg.envUrl}/api/data-query${backendPath}`, {
    method,
    headers: h,
    body: payload,
  });
}

async function requestJson(cfg, method, backendPath, body, headers) {
  const res = await request(cfg, method, backendPath, body, headers);
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json.success === false) die(json.message);
  return json;
}

async function ask(cfg, argv) {
  return analystCommand(cfg, ["ask", ...argv]);
}

// test-datasource and use-datasource take the same arguments and send the same body.
function datasourceBody(cmd, argv) {
  if (argv[1] == null) die(`${cmd} requires a datasource type`);
  if (argv[2] == null) die(`${cmd} requires a JSON payload`);
  const payload = JSON.parse(readInput(argv[2]));
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    die(`${cmd} payload must be a JSON object`);
  return { ...payload, type: argv[1] };
}

async function uploadVector(cfg, argv) {
  const arg = argv[0];
  if (arg == null) die("upload-vector requires a JSON payload");
  const payload = JSON.parse(readInput(arg));
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    die("upload-vector payload must be a JSON object");
  const { className, attrName, objectId, text, suffix } = payload;
  if (!className || !attrName || !objectId || !text)
    die(
      "upload-vector payload requires className, attrName, objectId and text",
    );
  const sfx = suffix || "txt";
  const form = new FormData();
  form.append(
    "file",
    new Blob([text], { type: "text/plain" }),
    `${objectId}.${sfx}`,
  );
  form.append("content", text);
  form.append("className", className);
  form.append("attrName", attrName);
  form.append("objectId", objectId);
  form.append("suffix", sfx);
  const res = await fetch(
    `${cfg.envUrl}/api/data-query/vectorResource/upload`,
    {
      method: "POST",
      body: form,
    },
  );
  const resText = await res.text();
  if (!res.ok) die(`${res.status}\n${resText}`);
  const json = JSON.parse(resText);
  if (json.success === false) die(json.message);
  console.log("vector uploaded");
}

function usage() {
  die(`usage:
  ontomato.mjs list-datasources
  ontomato.mjs test-datasource <type> <json|@file>
  ontomato.mjs use-datasource <type> <json|@file>
  ontomato.mjs get-ontomap
  ontomato.mjs set-ontomap <json|@file>
  ontomato.mjs get-knowledge
  ontomato.mjs save-knowledge <json|@file>
  ontomato.mjs delete-knowledge <id>
  ontomato.mjs upload-vector <json|@file>
  ontomato.mjs ask [--lang <tag>] <question>`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const cfg = loadConfig();
  if (!cfg.envUrl) die("Set ONTOMATO_URL or envUrl in application.yml");
  if (cmd === "list-datasources") {
    const json = await requestJson(cfg, "GET", "/businessConfig/dataAdapters");
    console.log(JSON.stringify(json.data, null, 2));
    return;
  }
  if (cmd === "test-datasource") {
    const json = await requestJson(
      cfg,
      "POST",
      "/businessConfig/testDataAdapter",
      datasourceBody(cmd, argv),
    );
    console.log(JSON.stringify(json.data, null, 2));
    return;
  }
  if (cmd === "use-datasource") {
    await requestJson(
      cfg,
      "POST",
      "/businessConfig/useDataAdapter",
      datasourceBody(cmd, argv),
    );
    console.log("datasource set");
    return;
  }
  if (cmd === "get-ontomap") {
    const json = await requestJson(cfg, "GET", "/admin/getSchema");
    console.log(JSON.stringify(json.data, null, 2));
    return;
  }
  if (cmd === "set-ontomap") {
    if (argv[1] == null) die("set-ontomap requires a JSON payload");
    await requestJson(
      cfg,
      "POST",
      "/admin/setSchema",
      JSON.parse(readInput(argv[1])),
    );
    console.log("ontomap saved");
    return;
  }
  if (cmd === "get-knowledge") {
    const json = await requestJson(
      cfg,
      "POST",
      "/admin/getBussinessKnowledge",
      {},
    );
    console.log(JSON.stringify(Object.values(json.data), null, 2));
    return;
  }
  if (cmd === "save-knowledge") {
    if (argv[1] == null) die("save-knowledge requires a JSON payload");
    const payload = JSON.parse(readInput(argv[1]));
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        die("Each knowledge entry must be a JSON object");
      await requestJson(
        cfg,
        "POST",
        entry.knowledgeID
          ? "/admin/editBussinessKnowledge"
          : "/admin/addBussinessKnowledge",
        entry,
        { "Accept-Language": "en" },
      );
      console.log(`knowledge saved: ${entry.knowledgeTitle}`);
    }
    return;
  }
  if (cmd === "delete-knowledge") {
    if (argv[1] == null) die("delete-knowledge requires an ID");
    await requestJson(
      cfg,
      "POST",
      "/admin/delBussinessKnowledge",
      { knowledgeID: argv[1] },
      { "Accept-Language": "en" },
    );
    console.log("knowledge deleted");
    return;
  }
  if (cmd === "upload-vector") {
    await uploadVector(cfg, argv.slice(1));
    return;
  }
  if (cmd === "ask") {
    await ask(cfg, argv.slice(1));
    return;
  }
  usage();
}

main();
