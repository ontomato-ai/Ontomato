import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const operations = new Set(["schema", "dsl-reference", "distinct-values", "execute-dsl"]);

/** Independent reads use the existing authorized endpoints; failures never become empty data. */
export async function probeBatch(items, env = process.env, request = fetch) {
  if (!Array.isArray(items) || !items.length || items.length > 32)
    throw new Error("Provide between 1 and 32 independent probes");
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) ||
        !operations.has(item.operation) || !item.input || typeof item.input !== "object" || Array.isArray(item.input))
      throw new Error("Each probe requires a unique id, a supported operation and an input object");
    ids.add(item.id);
  }
  const base = env.ONTOMATO_ONTOLOGY_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Set ONTOMATO_ONTOLOGY_URL (see SKILL.md)");
  const headers = {
    "Content-Type": "application/json", "Accept-Language": env.ONTOMATO_LANGUAGE ?? "en",
    ...(env.ONTOMATO_TK ? { tk: env.ONTOMATO_TK } : {}),
    ...(env.ONTOMATO_API_KEY ? { "X-API-Key": env.ONTOMATO_API_KEY } : {}),
    ...(env.ONTOMATO_EXECUTION_CALLBACK ? { "X-Ontomato-Callback-Credential": env.ONTOMATO_EXECUTION_CALLBACK } : {}),
    ...(env.ONTOMATO_RUN_ID ? { "X-Ontomato-Run-Id": env.ONTOMATO_RUN_ID } : {}),
    ...(env.ONTOMATO_SESSION_ID ? { "X-Ontomato-Session-Id": env.ONTOMATO_SESSION_ID } : {}),
    ...(env.ONTOMATO_CORRELATION_ID ? { "X-Correlation-Id": env.ONTOMATO_CORRELATION_ID } : {}),
    ...(env.ONTOMATO_RETRIEVAL_CALLER_ID ? { "X-Ontomato-Retrieval-Caller-Id": env.ONTOMATO_RETRIEVAL_CALLER_ID } : {}),
  };
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const { id, operation, input } = items[index];
      try {
        const response = await request(`${base}/ontology/query/${operation}`, {
          method: "POST", headers, redirect: "error", body: JSON.stringify(input),
        });
        const result = await response.json();
        if (!response.ok || result.success === false || result.error) {
          results[index] = { id, ok: false, status: response.status,
            error: { code: result.error?.code ?? "PROBE_FAILED", message: "Probe refused; inspect the original response", response: result } };
        } else results[index] = { id, ok: true, result };
      } catch {
        results[index] = { id, ok: false, error: { code: "PROBE_TRANSPORT_FAILED", message: "Probe transport or response parsing failed" } };
      }
    }
  }));
  return { results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    if (!file || process.argv.length !== 3) throw new Error("Use probe.mjs @work/probes.json");
    const output = await probeBatch(JSON.parse(await readFile(file.replace(/^@/, ""), "utf8")));
    console.log(JSON.stringify(output));
    if (output.results.some(item => !item.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
