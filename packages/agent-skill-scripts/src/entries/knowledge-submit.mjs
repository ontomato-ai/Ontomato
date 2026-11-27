#!/usr/bin/env node
import { readJson } from "../shared/client.mjs";

const callback = process.env.ONTOMATO_KNOWLEDGE_SUBMIT_URL;
if (!callback) throw new Error("ONTOMATO_KNOWLEDGE_SUBMIT_URL is required");
const [command, input] = process.argv.slice(2);
if (command !== "submit" || input === undefined || process.argv.length !== 4)
  throw new Error("Usage: submit <json|@file>");
const value = readJson(input);
const response = await fetch(callback, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "X-Ontomato-Callback-Credential": process.env.ONTOMATO_EXECUTION_CALLBACK ?? "",
  },
  body: JSON.stringify(value),
  redirect: "error",
});
const result = await response.json();
if (!response.ok || result?.error) {
  const message = typeof result?.error === "string" ? result.error
    : (result?.error?.message ?? result?.message ?? `HTTP ${response.status}`);
  throw new Error(message);
}
console.log(JSON.stringify(result, null, 2));
