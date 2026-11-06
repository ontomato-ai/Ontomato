#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function printEvent(ev) {
  if (ev.error != null) {
    console.error(ev.error);
    process.exit(1);
  }
  if (ev.type === "MESSAGE_TYPE") {
    const content = ev.content;
    console.log(content.message != null ? content.message : content.content);
    return;
  }
  if (ev.type === "DATA_TYPE") {
    console.log(ev.content.question);
    console.log(JSON.stringify(ev.content.data, null, 2));
    return;
  }
  if (ev.sessionId != null && ev.type == null) {
    console.log(`session ${ev.sessionId}`);
    return;
  }
  console.log(JSON.stringify(ev));
}

function printFrame(frame) {
  const lines = [];
  for (const raw of frame.split("\n")) {
    if (!raw || raw.startsWith(":")) continue;
    if (!raw.startsWith("data:")) continue;
    let value = raw.slice(5);
    if (value.startsWith(" ")) value = value.slice(1);
    lines.push(value);
  }
  if (lines.length === 0) return;
  printEvent(JSON.parse(lines.join("\n")));
}

async function printSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      printFrame(frame);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) printFrame(buf);
}

async function ask(cfg, argv) {
  let lang = "en";
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--lang") {
      i += 1;
      if (argv[i] == null) die("--lang requires a value");
      lang = argv[i];
      continue;
    }
    words.push(argv[i]);
  }
  if (words.length === 0) die("ask requires a question");
  const res = await request(cfg, "POST", "/abcHarness", { question: words.join(" ") }, {
    "Accept-Language": lang,
  });
  if (!res.ok) die(`${res.status}\n${await res.text()}`);
  await printSse(res);
}

// test-datasource and use-datasource take the same arguments and send the same body.
function datasourceBody(cmd, argv) {
  if (argv[1] == null) die(`${cmd} requires a datasource type`);
  if (argv[2] == null) die(`${cmd} requires a JSON payload`);
  const payload = JSON.parse(readInput(argv[2]));
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) die(`${cmd} payload must be a JSON object`);
  return { ...payload, type: argv[1] };
}

async function readResponseJson(res) {
  const text = await res.text();
  if (!res.ok) die(`${res.status}\n${text}`);
  const json = JSON.parse(text);
  if (json.success === false) die(json.message);
  return json;
}

// One resource: `text` is what is embedded and shown; `file` (optional) is the original file stored as the resource.
async function uploadVector(cfg, argv) {
  const arg = argv[0];
  if (arg == null) die("upload-vector requires a JSON payload");
  const payload = JSON.parse(readInput(arg));
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) die("upload-vector payload must be a JSON object");
  const { className, attrName, objectId, text, file } = payload;
  if (!className || !attrName || !objectId || !text) die("upload-vector payload requires className, attrName, objectId and text");
  const form = new FormData();
  form.append("content", text);
  form.append("className", className);
  form.append("attrName", attrName);
  form.append("objectId", objectId);
  if (file) {
    form.append("suffix", path.extname(file).replace(/^\./, "").toLowerCase());
    form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  const res = await fetch(`${cfg.envUrl}/api/data-query/vectorResource/upload`, {
    method: "POST",
        body: form,
  });
  const json = await readResponseJson(res);
  console.log(JSON.stringify(json.data, null, 2));
}

function takeOption(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (argv[i + 1] == null) die(`${name} requires a value`);
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}

function nonNegative(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) die(`${name} must be a non-negative integer`);
  return n;
}

// Text-only resources in batches through the `items` form of /vectorResource/upload. Each JSONL line is
// {"className","attrName","objectId","text"}; every item succeeds or fails on its own.
async function uploadVectors(cfg, argv) {
  const from = nonNegative(takeOption(argv, "--from") ?? 0, "--from");
  const batch = nonNegative(takeOption(argv, "--batch") ?? 100, "--batch") || 100;
  if (argv.length !== 1) die("upload-vectors requires <file.jsonl>");
  const file = argv[0].replace(/^@/, "");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim());
  const items = lines.map((line, i) => {
    const item = JSON.parse(line);
    if (!item.className || !item.attrName || !item.objectId || !item.text) die(`line ${i + 1} requires className, attrName, objectId and text`);
    return { className: item.className, attrName: item.attrName, objectId: String(item.objectId), content: item.text };
  });
  const failedFile = `${file}.failed.jsonl`;
  let ok = 0;
  let failed = 0;
  for (let start = from; start < items.length; start += batch) {
    const part = items.slice(start, start + batch);
    const form = new FormData();
    form.append("items", JSON.stringify(part));
    const res = await fetch(`${cfg.envUrl}/api/data-query/vectorResource/upload`, {
      method: "POST",
            body: form,
    });
    const text = await res.text();
    const json = res.ok ? JSON.parse(text) : null;
    if (!json || json.success !== true) {
      die(`batch from line ${start + 1} failed: ${json ? json.message : `${res.status} ${text}`}\nResume with --from ${start} after checking which items of this batch were stored.`);
    }
    for (const result of json.data) {
      if (result.success) ok++;
      else {
        failed++;
        // result.index counts within this request.
        fs.appendFileSync(failedFile, `${JSON.stringify({ line: start + result.index + 1, objectId: part[result.index]?.objectId, message: result.message })}\n`);
      }
    }
    console.log(`${Math.min(start + batch, items.length)}/${items.length} ok=${ok} failed=${failed}`);
  }
  if (failed) console.log(`failed items: ${failedFile}`);
}

async function deleteVector(cfg, argv) {
  if (argv.length !== 4) die("delete-vector requires <class> <attribute> <objectId> <path>");
  const [className, attrName, objectId, resourcePath] = argv;
  await requestJson(cfg, "POST", "/vectorResource/delete", { className, attrName, objectId, path: resourcePath });
  console.log("vector deleted");
}

async function importTestData(cfg, argv) {
  if (argv[0] == null) die("import-test-data requires a zip file");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(argv[0])], { type: "application/zip" }), path.basename(argv[0]));
  const res = await fetch(`${cfg.envUrl}/api/data-query/testEnv/importData`, {
    method: "POST",
        body: form,
  });
  await readResponseJson(res);
  console.log("test data imported");
}

// Direct business database writes. databaseCommand is a JSON argv array of a database client that reads SQL
// from stdin (psql or mysql); databaseType picks the SQL dialect.
function database(cfg) {
  if (!cfg.databaseCommand) die("Set databaseCommand (a JSON argv array) and databaseType in application.yml");
  let argv;
  try {
    argv = JSON.parse(cfg.databaseCommand);
  } catch {
    die("databaseCommand must be a JSON array of strings");
  }
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string")) die("databaseCommand must be a JSON array of strings");
  if (cfg.databaseType !== "postgresql" && cfg.databaseType !== "mysql") die("databaseType must be postgresql or mysql");
  return { argv, type: cfg.databaseType };
}

function runSql(db, sql) {
  const result = spawnSync(db.argv[0], db.argv.slice(1), { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
  if (result.error) die(`databaseCommand failed to start: ${result.error.message}`);
  if (result.status !== 0) die(`databaseCommand exited with ${result.status}; the current transaction was not committed`);
}

function transaction(db, statements) {
  return `${db.type === "postgresql" ? "BEGIN" : "START TRANSACTION"};\n${statements.join("\n")}\nCOMMIT;\n`;
}

function quoteIdentifier(db, name) {
  return name
    .split(".")
    .map((part) => (db.type === "postgresql" ? `"${part.replace(/"/g, '""')}"` : `\`${part.replace(/`/g, "``")}\``))
    .join(".");
}

function quoteLiteral(db, value) {
  const escaped = db.type === "mysql" ? value.replace(/\\/g, "\\\\").replace(/'/g, "''") : value.replace(/'/g, "''");
  return `'${escaped}'`;
}

// RFC 4180 CSV. An unquoted empty field is NULL; a quoted empty field ("") is an empty string.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === "") { inQuotes = true; quoted = true; any = true; continue; }
    if (c === ",") { row.push({ value: field, quoted }); field = ""; quoted = false; any = true; continue; }
    if (c === "\r" && text[i + 1] === "\n") continue;
    if (c === "\n") {
      if (any || field) row.push({ value: field, quoted });
      if (row.length) rows.push(row);
      row = []; field = ""; quoted = false; any = false;
      continue;
    }
    field += c;
    any = true;
  }
  if (inQuotes) die("CSV ends inside a quoted field");
  if (any || field) row.push({ value: field, quoted });
  if (row.length) rows.push(row);
  return rows;
}

async function dbImport(cfg, argv) {
  const from = nonNegative(takeOption(argv, "--from") ?? 0, "--from");
  const batch = nonNegative(takeOption(argv, "--batch") ?? 500, "--batch") || 500;
  if (argv.length !== 2) die("db-import requires <table> <file.csv>");
  const db = database(cfg);
  const [table, file] = argv;
  const rows = parseCsv(fs.readFileSync(file.replace(/^@/, ""), "utf8").replace(/^﻿/, ""));
  if (rows.length === 0) die("CSV has no header row");
  const columns = rows[0].map((cell) => cell.value);
  const data = rows.slice(1);
  data.forEach((row, i) => {
    if (row.length !== columns.length) die(`CSV row ${i + 2} has ${row.length} fields; the header has ${columns.length}`);
  });
  const head = `INSERT INTO ${quoteIdentifier(db, table)} (${columns.map((c) => quoteIdentifier(db, c)).join(", ")}) VALUES`;
  for (let start = from; start < data.length; start += batch) {
    const values = data.slice(start, start + batch).map((row) =>
      `(${row.map((cell) => (cell.value === "" && !cell.quoted ? "NULL" : quoteLiteral(db, cell.value))).join(", ")})`);
    runSql(db, transaction(db, [`${head}\n${values.join(",\n")};`]));
    console.log(`${Math.min(start + batch, data.length)}/${data.length} rows imported into ${table}`);
  }
}

function dbSql(cfg, argv) {
  if (argv[0] == null) die("db-sql requires SQL or @file.sql");
  const db = database(cfg);
  runSql(db, transaction(db, [readInput(argv[0])]));
  console.log("sql executed");
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
  ontomato.mjs db-sql <sql|@file.sql>
  ontomato.mjs db-import <table> <file.csv> [--from <rows>] [--batch <rows>]
  ontomato.mjs import-test-data <file.zip>
  ontomato.mjs upload-vector <json|@file>
  ontomato.mjs upload-vectors <file.jsonl> [--from <lines>] [--batch <lines>]
  ontomato.mjs delete-vector <class> <attribute> <objectId> <path>
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
    const json = await requestJson(cfg, "POST", "/businessConfig/testDataAdapter", datasourceBody(cmd, argv));
    console.log(JSON.stringify(json.data, null, 2));
    return;
  }
  if (cmd === "use-datasource") {
    await requestJson(cfg, "POST", "/businessConfig/useDataAdapter", datasourceBody(cmd, argv));
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
    await requestJson(cfg, "POST", "/admin/setSchema", JSON.parse(readInput(argv[1])));
    console.log("ontomap saved");
    return;
  }
  if (cmd === "get-knowledge") {
    const json = await requestJson(cfg, "POST", "/admin/getBussinessKnowledge", {});
    console.log(JSON.stringify(Object.values(json.data), null, 2));
    return;
  }
  if (cmd === "save-knowledge") {
    if (argv[1] == null) die("save-knowledge requires a JSON payload");
    const payload = JSON.parse(readInput(argv[1]));
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) die("Each knowledge entry must be a JSON object");
      await requestJson(cfg, "POST", entry.knowledgeID ? "/admin/editBussinessKnowledge" : "/admin/addBussinessKnowledge", entry, { "Accept-Language": "en" });
      console.log(`knowledge saved: ${entry.knowledgeTitle}`);
    }
    return;
  }
  if (cmd === "delete-knowledge") {
    if (argv[1] == null) die("delete-knowledge requires an ID");
    await requestJson(cfg, "POST", "/admin/delBussinessKnowledge", { knowledgeID: argv[1] }, { "Accept-Language": "en" });
    console.log("knowledge deleted");
    return;
  }
  if (cmd === "upload-vector") {
    await uploadVector(cfg, argv.slice(1));
    return;
  }
  if (cmd === "upload-vectors") {
    await uploadVectors(cfg, argv.slice(1));
    return;
  }
  if (cmd === "delete-vector") {
    await deleteVector(cfg, argv.slice(1));
    return;
  }
  if (cmd === "import-test-data") {
    await importTestData(cfg, argv.slice(1));
    return;
  }
  if (cmd === "db-sql") {
    dbSql(cfg, argv.slice(1));
    return;
  }
  if (cmd === "db-import") {
    await dbImport(cfg, argv.slice(1));
    return;
  }
  if (cmd === "ask") {
    await ask(cfg, argv.slice(1));
    return;
  }
  usage();
}

main();
