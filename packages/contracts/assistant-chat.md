# Workbench assistant actions

Approved 2026-10-28. [src/assistant-chat.ts](src/assistant-chat.ts) owns these shapes
(`@ontomato/contracts/assistant-chat`). The workbench implements the complete
[common host proxy](agent-host.md) at **`/api/assistant`** with `workbenchId=business`.
This file owns only workbench-specific actions. All paths below are relative to
that prefix; `S` = `/sessions/:sessionId`, `F` = `S/artifacts/:artifactId`.
Every conversation/file/feedback operation checks both user and domain; definition
management requires the existing **`analysis-agent`** permission. Errors use
AgentHostError. Shell action slots call these endpoints; feedback stays in workbench.

| Method/path | Input | Output (200 unless listed) |
| --- | --- | --- |
| GET `/agent-definitions` | `workbenchId` | `AssistantAgentDefinitionList` |
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
and maxDepth 0–10), enabledMcpServiceNames and sortOrder. Both presets are ordinary
editable definitions. The common `/agents` endpoint exposes only selector metadata,
never the prompt or these business settings. Deleted definitions do not delete
history, and cannot admit new runs. Old executor/dimension/report/summary/hot-report
fields are rejected and are not read from legacy definition rows.

classNames scopes retrieval as before. graphScope selects initial ontology context,
not the formal retrieval allow-list. External MCP names retain their existing domain
configuration meaning. External MCP is not effective yet: names are saved/edited
but are not passed into runtime (controller's provisional decision).
Analysis and visualization skills share one RuntimeSkillRef list. Session messages,
events and files remain runtime-owned; host indexes do not duplicate message bodies.

Feedback upserts one value per user/session/run/target; dislike requires a reason.
The host validates target ownership and resolves question/output from runtime.
Accepted copied datasets must match their original receipt/digest; dataset-source
returns the original retrieval/artifact IDs and the existing optional QC result.
QC refresh is independent of the assistant stop. Dashboard create/add uses
[dashboard-artifacts](src/dashboard-artifacts.ts) references instead of checkpoint
indexes. Scheduled execution remains disabled with stored data retained. Moving
feedback, QC annotations and decisions into runtime is outside this batch.
