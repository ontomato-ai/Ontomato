import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseJsonText } from "../shared/json-input.mjs";

export async function generationCommand(args, env = process.env, request = fetch) {
  const [command, ...values] = args;
  const base = env.ONTOMATO_GENERATION_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Set ONTOMATO_GENERATION_URL");
  async function call(route, body) {
    const response = await request(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ontomato-Callback-Credential": env.ONTOMATO_EXECUTION_CALLBACK,
      },
      redirect: "error",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? `HTTP ${response.status}`);
    return result;
  }
  const bodyFile = async (name) => parseJsonText(await readFile(name.replace(/^@/, ""), "utf8"), name.replace(/^@/, ""));
  let operation = command, body;
  switch (command) {
    case "explain":
      operation = "explainDraft";
      body = {};
      break;
    case "test-package": {
      if (!values[0] || !values[1]) throw new Error("test-package requires a package entry and column labels");
      const { collectPackage } = await import("../shared/query-package.mjs");
      body = { queryPackage: await collectPackage(values[0]), columnLabels: await bodyFile(values[1]) };
      operation = "test";
      break;
    }
    case "test":
      if (!values[0] || !values[1]) throw new Error("test requires source and parameter definition files");
      body = { code: await readFile(values[0], "utf8"), parameterDefs: await bodyFile(values[1]) };
      if (values[2]) body.sourceAnalysis = await bodyFile(values[2]);
      if (!Array.isArray(body.parameterDefs)) throw new Error("Parameter definitions must be an array");
      break;
    case "prepare": body = await bodyFile(values[0]); break;
    case "query": body = { dsl: await bodyFile(values[0]) }; break;
    case "reset": body = {}; break;
    case "source": case "helpers": break;
    default: throw new Error("Commands: explain, helpers, source, test-package, test, prepare, reset, query");
  }
  const { runId, kind } = await call("/runtime-context");
  if (command === "source" && kind !== "explain")
    throw new Error("source is only available for explain runs; use explain to refresh the structured definition");
  const result = await call(`/${runId}/${operation}`, body);
  if (command === "source") {
    const start = values[0] === undefined ? 1 : Number(values[0]);
    const end = values[1] === undefined ? undefined : Number(values[1]);
    if (!Number.isInteger(start) || start < 1 || (end !== undefined && (!Number.isInteger(end) || end < start)))
      throw new Error("Invalid source line range");
    return result.source.split("\n").slice(start - 1, end).join("\n");
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await generationCommand(process.argv.slice(2)), null, 2));
