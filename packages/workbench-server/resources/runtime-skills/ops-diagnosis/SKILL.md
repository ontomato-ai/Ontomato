---
name: ops-diagnosis
description: >-
  Diagnose an Ontomato question or service fault using authorized read-only evidence: service logs, runtime sessions and artifacts, configuration, health, metadata, DSL queries and operations knowledge.
---

# Operations diagnosis

Start with the user's symptom and expected result. Resolve a supplied assistant run,
Turn key or test case before selecting logs. A successful answer is not evidence of
business correctness; ask for the expected definition/result when it is missing.

Use the same CLI inside a runtime workspace or any external Agent Skills harness:

```sh
node skills/ops-diagnosis/scripts/ops.mjs resolve '{"kind":"assistant-run","sessionId":"SESSION_UUID","runId":"RUN_UUID"}'
node skills/ops-diagnosis/scripts/ops.mjs logs '{"service":"workbench","correlationId":"CORRELATION","from":"2026-10-29T00:00:00.000Z","to":"2026-10-29T00:05:00.000Z","limit":20}'
node skills/ops-diagnosis/scripts/ops.mjs run '{"owner":"workbench","sessionId":"SESSION_UUID","runId":"RUN_UUID"}'
node skills/ops-diagnosis/scripts/ops.mjs artifact '{"owner":"ontology","sessionId":"SESSION_UUID","artifactId":"ARTIFACT_UUID","content":true}'
node skills/ops-diagnosis/scripts/ops.mjs query '{"query":{"answer":{"steps":[{"graph":{"pattern_logic":"and","patterns":[{"objects":[{"idx":0,"variable":"item","class":"CLASS"}],"relationship":[]}]},"output":{"to_user":true,"fields":[{"variable":"item","field":"FIELD","as":"value"}],"limit":{"count":1,"offset":0}}}]}},"limit":1}'
node skills/ops-diagnosis/scripts/ops.mjs config '{}'
node skills/ops-diagnosis/scripts/ops.mjs health '{}'
node skills/ops-diagnosis/scripts/ops.mjs metadata '{"format":"json"}'
node skills/ops-diagnosis/scripts/ops.mjs knowledge '{"path":"index.md"}'
```

Pass one read DSL object as `query`, with a non-empty `answer.steps` array. Replace `CLASS`
and `FIELD` with names from metadata. Set the DSL `output.limit` to bound the query and
the outer `limit` to bound the returned preview. When joining multiple objects, filter
and project detail rows in the first step with `output.save_table` and `to_user:false`.
Read that temporary table as a single object in the next step to aggregate, group
or deduplicate. No raw SQL, Action, scheduled function execution, Python execution
or environment mutation is exposed. `session` takes owner/sessionId. `artifact` defaults to metadata;
`content:true` reads immutable bytes, and optional `out:"work/source.ext"` saves
those bytes in the local working directory. It never reads a server path.
`resolve` also accepts `{kind:"turn",turnKey}` or
`{kind:"autotest-case",testRunId,caseId}`. `knowledge {}` lists the knowledge tree.

In the platform (`ONTOMATO_SKILL_SCENARIO=platform`), the runtime forwards
`ONTOMATO_WORKBENCH_URL` directly to the `/api/observe/evidence` callback prefix and
supplies `ONTOMATO_EXECUTION_CALLBACK` (sent as `X-Ontomato-Callback-Credential`) with
session trace headers managed at the forwarding boundary. Outside the product, set
`ONTOMATO_WORKBENCH_URL` to the workbench base URL before `/api`, and set `ONTOMATO_TK`
(`tk` header) or `ONTOMATO_API_KEY` (`X-API-Key` header). Set only one credential
variable; `ONTOMATO_RUN_ID`, `ONTOMATO_SESSION_ID`, `ONTOMATO_CORRELATION_ID` and
`ONTOMATO_LANGUAGE` are optional outside the product. Credentials are never command
arguments.

Read each service independently (`workbench`, `ontology`, `agent-runtime`). Reuse
the exact filters/window and `nextCursor` for the next page. Do not guess identities
from prefixes, overwrite a target's correlation, or infer no execution from empty
logs. PG is best-effort and subject to retention. Runtime messages and artifacts
have different owners and permissions from service logs. An unavailable ontology
source is an evidence gap; do not try another identity or privileged endpoint.

Compare the user-visible outcome, runtime tool/artifact facts, relevant service
errors and current authorized data. Use `query` only to verify a specific hypothesis,
with the caller's current data permissions. Its rows are a preview: preserve
receivedRowCount and upstreamTruncation; never calculate full totals from samples.
The CLI explicitly marks abbreviated output; obtain narrower evidence when needed.

Give the earliest supported deviation, cited run/artifact/event IDs, query windows,
coverage gaps and the next user action. A suggested fix is not an executed fix.
You may write a diagnosis report under outputs/ using normal workspace tools and
reference it in Markdown. Do not bulk-copy logs, reconstruct prompts from logs,
run host commands, scan host files, or start tests/queries to reproduce an incident
without an explicit user-operated product action.
