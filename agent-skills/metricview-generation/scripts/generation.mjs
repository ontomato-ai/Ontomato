import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function metricViewCommand(args, env = process.env, request = fetch) {
  const [command, ...values] = args;
  const base = env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL");
  const statePath = "work/.metricview-generation.json";
  let state = env.ONTOMATO_GENERATION_ID ? { runId: env.ONTOMATO_GENERATION_ID } : null;
  if (!state && command !== "begin") state = JSON.parse(await readFile(statePath, "utf8"));
  const bodyFile = async (name) => JSON.parse(await readFile(name.replace(/^@/, ""), "utf8"));
  let route, body;
  switch (command) {
    case "begin":
      if (env.ONTOMATO_GENERATION_ID) throw new Error("The host already owns this gate");
      route = "/gates";
      body = { kind: "metric", source: values[0] ? await readFile(values[0], "utf8") : null };
      break;
    case "test":
      if (!values[0] || !values[1]) throw new Error("test requires source and parameter definition files");
      body = { code: await readFile(values[0], "utf8"), parameterDefs: await bodyFile(values[1]) };
      if (values[2]) body.sourceAnalysis = await bodyFile(values[2]);
      if (!Array.isArray(body.parameterDefs)) throw new Error("Parameter definitions must be an array");
      break;
    case "close": body = {}; break;
    default: throw new Error("Commands: begin, test, close");
  }
  route ??= `/${state.runId}/${command}`;
  const response = await request(base + "/ontology/ai/generation" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest",
      "X-Correlation-Id": state?.runId ?? randomUUID(),
      ...(state ? { "X-Ontomato-Run-Id": state.runId } : {}),
      tk: env.ONTOMATO_TK ?? "",
      ...(env.ONTOMATO_API_KEY ? { "X-API-Key": env.ONTOMATO_API_KEY } : {}),
    },
    redirect: "error",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? `HTTP ${response.status}`);
  if (command === "begin") {
    await mkdir("work", { recursive: true });
    await writeFile(statePath, JSON.stringify(result));
  } else if (command === "close" && !env.ONTOMATO_GENERATION_ID) await rm(statePath, { force: true });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await metricViewCommand(process.argv.slice(2)), null, 2));
