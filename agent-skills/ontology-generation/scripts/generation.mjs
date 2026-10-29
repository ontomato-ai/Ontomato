import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function generationCommand(args, env = process.env, request = fetch) {
  const [command, ...values] = args;
  const base = env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL");
  const statePath = "work/.ontology-generation.json";
  let state = env.ONTOMATO_GENERATION_ID ? { runId: env.ONTOMATO_GENERATION_ID } : null;
  if (!state && command !== "begin") state = JSON.parse(await readFile(statePath, "utf8"));
  const bodyFile = async (name) => JSON.parse(await readFile(name.replace(/^@/, ""), "utf8"));
  let route, body;
  switch (command) {
    case "begin":
      if (env.ONTOMATO_GENERATION_ID) throw new Error("The host already owns this gate");
      route = "/gates";
      body = { kind: values[0], source: values[1] ? await readFile(values[1], "utf8") : null };
      break;
    case "test":
      if (!values[0] || !values[1]) throw new Error("test requires source and parameter definition files");
      body = { code: await readFile(values[0], "utf8"), parameterDefs: await bodyFile(values[1]) };
      if (!Array.isArray(body.parameterDefs)) throw new Error("Parameter definitions must be an array");
      break;
    case "prepare": body = await bodyFile(values[0]); break;
    case "query": body = { dsl: await bodyFile(values[0]) }; break;
    case "reset": case "close": body = {}; break;
    case "source": break;
    default: throw new Error("Commands: begin, source, test, prepare, reset, query, close");
  }
  route ??= `/${state.runId}/${command}`;
  const response = await request(base + "/ontology/ai/generation" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest",
      "X-Correlation-Id": state?.runId ?? randomUUID(),
      ...(state ? { "X-Ontomato-Run-Id": state.runId } : {}),
      tk: env.ONTOMATO_GENERATION_TK ?? env.ONTOMATO_TK ?? "",
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
