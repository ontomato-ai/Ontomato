import fs from "node:fs/promises";
import path from "node:path";

const endpoints = {
  ontology_overview: ["GET", "/overview"],
  ontology_schema: ["POST", "/schema"],
  ontology_dsl_reference: ["POST", "/dsl-reference"],
  ontology_distinct_values: ["POST", "/distinct-values"],
  ontology_execute_dsl: ["POST", "/execute-dsl"],
  ontology_find_metrics: ["POST", "/metrics/search"],
  ontology_execute_metric: ["POST", "/metrics/execute"],
  ontology_find_knowledge: ["POST", "/knowledge/search"],
};
try {
  let stdin = "";
  for await (const chunk of process.stdin) stdin += chunk;
  const input = JSON.parse(stdin);
  const [method, endpoint] = endpoints[input.toolName] ?? [];
  if (!method) throw new Error("Unknown ontology tool");
  let body = input.arguments;
  if (input.toolName === "ontology_execute_dsl" && body.path) {
    const root = await fs.realpath(process.env.ONTOMATO_WORKSPACE);
    const target = await fs.realpath(path.resolve(root, body.path));
    if (!target.startsWith(root + path.sep) || !target.endsWith(".json"))
      throw new Error("DSL path must be a workspace JSON file");
    const dsl = JSON.parse(await fs.readFile(target, "utf8"));
    if (!dsl || typeof dsl !== "object" || Array.isArray(dsl))
      throw new Error("DSL file must contain one JSON object");
    body = { dsl };
  }
  const credential = JSON.parse(process.env.ONTOMATO_CREDENTIAL_JSON);
  const headers = {
    "content-type": "application/json",
    "Accept-Language": process.env.ONTOMATO_LANGUAGE,
    "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID,
    "X-Ontomato-Run-Id": process.env.ONTOMATO_RUN_ID,
  };
  if (credential.kind === "bearer")
    headers.Authorization = `Bearer ${credential.value}`;
  else if (credential.kind !== "none")
    headers[credential.kind === "token" ? "tk" : "X-API-Key"] =
      credential.value;
  const response = await fetch(
    process.env.ONTOMATO_TARGET_URL.replace(/\/$/, "") +
      "/ontology/query" +
      endpoint,
    {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body),
      redirect: "error",
    },
  );
  const data = await response.json();
  if (!response.ok || data.error)
    throw new Error(
      data.error?.message ??
        data.message ??
        `Ontology request failed (${response.status})`,
    );
  let view = data;
  if (data.data?.[0]?.answer?.length > 100)
    view = {
      ...data,
      data: [
        {
          ...data.data[0],
          answer: data.data[0].answer.slice(0, 100),
          previewOnly: true,
          returnedRows: data.data[0].answer.length,
        },
      ],
    };
  console.log(
    JSON.stringify({
      type: "result",
      text: JSON.stringify(view),
      data: view,
      artifacts: [],
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      type: "error",
      error: { code: "ONTOLOGY_TOOL_FAILED", message: error.message },
    }),
  );
  process.exitCode = 1;
}
