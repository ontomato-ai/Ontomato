import fs from "node:fs/promises";
import path from "node:path";

try {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text),
    context = JSON.parse(process.env.ONTOMATO_CONTEXT_JSON);
  const credential = JSON.parse(process.env.ONTOMATO_CREDENTIAL_JSON);
  const identity = {
    runId: process.env.ONTOMATO_RUN_ID,
    runtimeSessionId: process.env.ONTOMATO_SESSION_ID,
    toolCallId: process.env.ONTOMATO_TOOL_CALL_ID,
    invocationId: process.env.ONTOMATO_INVOCATION_ID,
  };
  let source;
  if (input.toolName === "submit_dataset" && input.arguments.path) {
    const root = await fs.realpath(process.env.ONTOMATO_WORKSPACE),
      file = await fs.realpath(path.resolve(root, input.arguments.path));
    if (!file.startsWith(root + path.sep) || !file.endsWith(".py"))
      throw new Error("A workspace Python file is required");
    source = await fs.readFile(file, "utf8");
  }
  const response = await fetch(
    `${process.env.ONTOMATO_TARGET_URL}/${context.retrievalId}/runtime/${input.toolName}`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.value}`,
        "Accept-Language": process.env.ONTOMATO_LANGUAGE,
        "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID,
      },
      body: JSON.stringify({ identity, arguments: input.arguments, source }),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : (data.error?.message ??
            data.message ??
            `Retrieval callback failed (${response.status})`),
    );
  console.log(
    JSON.stringify({
      type: "result",
      text: JSON.stringify(data.result),
      data: data.result,
      artifacts: data.artifacts ?? [],
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      type: "error",
      error: { code: "RETRIEVAL_TOOL_FAILED", message: error.message },
    }),
  );
  process.exitCode = 1;
}
