# Workbench assistant actions

Approved 2026-10-28. [src/assistant-chat.ts](src/assistant-chat.ts) owns these shapes
(`@ontomato/contracts/assistant-chat`). The workbench implements the complete
[common host proxy](agent-host.md) at **`/api/assistant`**.
This file owns only workbench-specific actions. All paths below are relative to
that prefix; `S` = `/sessions/:sessionId`, `F` = `S/artifacts/:artifactId`.
Every conversation/file/feedback operation checks both user and domain; definition
management requires the existing **`analysis-agent`** permission. Errors use
AgentHostError. Shell action slots call these endpoints; feedback stays in workbench.

[Domain skills](domain-skills.md) specifies
the complete selectable skill catalogue and per-run package preparation.

| Method/path | Input | Output (200 unless listed) |
| --- | --- | --- |
| GET `/agent-skills` | — | `AssistantSkillCatalog`; complete provider/domain choices |
| GET `/agent-definitions` | — | `AssistantAgentDefinitionList` |
| GET `/agent-definitions/:agentId` | — | `AssistantAgentDefinition` |
| POST `/agent-definitions` | `AssistantAgentInput`, UUID Idempotency-Key | 201 `AssistantAgentDefinition` |
| PUT `/agent-definitions/:agentId` | `AssistantAgentInput` | `AssistantAgentDefinition` |
| DELETE `/agent-definitions/:agentId` | — | 204; existing history remains readable |
| POST `S/export/ppt` | `{}` | PPTX from runtime history and accepted datasets |
| GET `F/dataset-source` | — | `AssistantDatasetSource`; generic file: 404 |
| GET `S/feedback` | optional runId | `AssistantFeedbackList` |
| PUT `S/feedback` | `AssistantFeedbackWrite` | `AssistantFeedback` |
| DELETE `S/feedback/:feedbackId` | — | 204 |

Definitions contain one systemPrompt, one skills list, modelRole, name, description,
icon, enabled, classNames, graphScope (`panorama` or `subgraph` with rootClassNames
and maxDepth 0–10), enabledMcpServiceIds and sortOrder. Both presets are ordinary
editable definitions. The common `/agents` endpoint exposes only selector metadata,
never the prompt or these business settings. Deleted definitions do not delete
history, and cannot admit new runs. Old executor/dimension/report/summary/hot-report
fields are rejected and are not read from legacy definition rows.

classNames scopes retrieval as before. graphScope selects initial ontology context,
not the formal retrieval allow-list. External MCP selections are runtime-assigned
service UUIDs. Workbench forwards them as `definition.externalMcp: {id}[]`;
[the MCP contract](agent-runtime-mcp.md) owns configuration and scoped resolution.
Renames preserve selections; deleted services are ignored at run start.
Analysis and visualization skills share one list. Definition writes may use
`{name, namespace:{kind:"domain"}}` for a skill in the caller's domain; the server
fills in the domain from the verified request identity, including the public
edition's anonymous identity. If a write includes domainId, it must match that
identity or return 403. The browser never chooses the effective domain. Definition
reads and runtime admission still use complete RuntimeSkillRef values. Provider
references keep `{kind:"provider",provider}` unchanged. Session messages,
events and files remain runtime-owned; host indexes do not duplicate message bodies.

Feedback upserts one value per user/session/run/target; dislike requires a reason.
The host validates target ownership and resolves question/output from runtime.
Accepted copied datasets must match their original receipt/digest; dataset-source
returns the original retrieval/artifact IDs and the existing optional QC result.
QC refresh is independent of the assistant stop. Dashboard create/add uses
[dashboard-artifacts](src/dashboard-artifacts.ts) references instead of checkpoint
indexes. Scheduled execution remains disabled with stored data retained. Moving
feedback, QC annotations and decisions into runtime is outside this batch.

## Ontology retrieval cutover

The [ontology retrieval contract](data-retrieval.md) replaces workbench
retrieval orchestration. The assistant retains parent associations and dataset
provenance, using ontology HTTP for child runs/files/QC and cancellation. Its
dataset-source shape above is unchanged. The assistant mounts
`ontomato-analyst-assistant`, which documents only the ontology metadata commands
and the same `ask`; external, retriever and generation execution use the complete
`ontomato-analyst`. `assistant-retrieval` is removed. This cutover does not extend
the common host proxy or move feedback into runtime.
