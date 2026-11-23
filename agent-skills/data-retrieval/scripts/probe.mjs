import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const operations = new Set(["schema", "dsl-reference", "distinct-values", "execute-dsl"]);
const nonblank = value => typeof value === "string" && value.trim().length > 0;

function distinctInput(input, schema) {
  const { className, attribute, like, limit = 100 } = input;
  if (!nonblank(className) || !nonblank(attribute)) return "Provide className and attribute from the schema";
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return "limit must be an integer from 1 to 100";
  if (like != null && typeof like !== "string") return "like must be text";
  if (schema) {
    const normalize = name => name.replace(/^\//, "");
    const cls = schema.classes.find(item => nonblank(item?.className) && normalize(item.className) === normalize(className));
    if (!cls) return `Class ${className} is absent from the supplied schema. Fetch its schema before probing.`;
    const field = Array.isArray(cls.attrs) && cls.attrs.find(item => item?.name === attribute && item.enable !== false);
    if (!field) return `Field ${className}.${attribute} is absent or disabled in the supplied schema.`;
    if (!["varchar", "text"].includes(field.type))
      return `Field ${className}.${attribute} has type ${field.type}. Use a scoped DSL query for non-text values.`;
  }
  return { ...input, limit };
}

/** Independent reads use the existing authorized endpoints; failures never become empty data. */
export async function probeBatch(items, env = process.env, request = fetch, schema) {
  if (!Array.isArray(items) || !items.length || items.length > 32)
    throw new Error("Provide between 1 and 32 independent probes");
  const ids = new Set();
  if (schema !== undefined && !Array.isArray(schema?.classes)) throw new Error("--schema requires an ontology schema response with classes");
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
      const prepared = operation === "distinct-values" ? distinctInput(input, schema) : input;
      if (typeof prepared === "string") {
        results[index] = { id, ok: false, error: { code: "INVALID_PROBE_INPUT", message: prepared } };
        continue;
      }
      try {
        const response = await request(`${base}/ontology/query/${operation}`, {
          method: "POST", headers, redirect: "error", body: JSON.stringify(prepared),
        });
        const result = await response.json();
        if (!response.ok || result.success === false || result.error) {
          results[index] = { id, ok: false, status: response.status,
            error: { code: result.error?.code ?? "PROBE_FAILED", message: (typeof result.error === "string" ? result.error : result.error?.message) ?? result.message ?? "Probe refused", response: result } };
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
    const [file, flag, schemaFile, ...rest] = process.argv.slice(2);
    if (!file || rest.length || (flag !== undefined && (flag !== "--schema" || !schemaFile)))
      throw new Error("Use probe.mjs @work/probes.json [--schema @work/schema.json]");
    const json = async (source) => JSON.parse(await readFile(source.replace(/^@/, ""), "utf8"));
    const output = await probeBatch(await json(file), process.env, fetch, schemaFile ? await json(schemaFile) : undefined);
    console.log(JSON.stringify(output));
    if (output.results.some(item => !item.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
