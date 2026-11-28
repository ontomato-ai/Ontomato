import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseJsonText } from "../shared/json-input.mjs";

export async function metricViewCommand(args, env = process.env, request = fetch) {
  const [command, packagePath, labelsPath] = args;
  if (command !== "test-package") throw new Error("Commands: test-package");
  if (!packagePath || !labelsPath) throw new Error("test-package requires a package entry and column labels");
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
  const { collectPackage } = await import("../shared/query-package.mjs");
  const queryPackage = await collectPackage(packagePath);
  const columnLabels = parseJsonText(await readFile(labelsPath.replace(/^@/, ""), "utf8"), labelsPath.replace(/^@/, ""));
  const { runId } = await call("/runtime-context");
  return call(`/${runId}/test`, { queryPackage, columnLabels });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await metricViewCommand(process.argv.slice(2)), null, 2));
