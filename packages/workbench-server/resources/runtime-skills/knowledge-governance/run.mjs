const input = JSON.parse(await new Response(process.stdin).text());
const context = JSON.parse(process.env.ONTOMATO_CONTEXT_JSON);
const credential = JSON.parse(process.env.ONTOMATO_CREDENTIAL_JSON);
const identity = {
  governanceSessionId: context.governanceSessionId,
  runtimeSessionId: process.env.ONTOMATO_SESSION_ID,
  runId: process.env.ONTOMATO_RUN_ID,
  invocationId: process.env.ONTOMATO_INVOCATION_ID,
  toolCallId: process.env.ONTOMATO_TOOL_CALL_ID || null,
};
const headers = {
  "Content-Type": "application/json",
  "Accept-Language": process.env.ONTOMATO_LANGUAGE,
  "X-Correlation-Id": process.env.ONTOMATO_CORRELATION_ID,
};
if (credential.kind === "token") headers.tk = credential.value;
if (credential.kind === "api_key") headers["X-API-Key"] = credential.value;
try {
  const suffix =
    input.kind === "context"
      ? "context"
      : `tools/${encodeURIComponent(input.toolName)}`;
  const response = await fetch(
    `${process.env.ONTOMATO_TARGET_URL}/${identity.governanceSessionId}/runtime/${suffix}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        identity,
        ...(input.kind === "tool" ? { arguments: input.arguments } : {}),
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    console.log(
      JSON.stringify({
        type: "error",
        error: {
          code: body.code || "GOVERNANCE_FAILED",
          message: body.error || "Governance request failed",
        },
      }),
    );
    process.exitCode = 1;
  } else if (input.kind === "context")
    console.log(
      JSON.stringify({
        type: "context_result",
        systemContext: body.systemContext,
      }),
    );
  else
    console.log(
      JSON.stringify({
        type: "result",
        text:
          typeof body.result === "string"
            ? body.result
            : JSON.stringify(body.result),
        data: body.result,
        artifacts: [],
      }),
    );
} catch {
  console.log(
    JSON.stringify({
      type: "error",
      error: {
        code: "GOVERNANCE_TRANSPORT_FAILED",
        message:
          "Governance request did not return a result; the external outcome is unknown",
      },
    }),
  );
  process.exitCode = 1;
}
