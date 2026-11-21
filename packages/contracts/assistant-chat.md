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
| POST `/agent-definitions/form` | `PanelFormRequest` | `PanelFormDescription`, reads or checks a settings draft without writing |
| POST `/agent-definitions/validate` | `{target,form}`; require `target.objectType: "platform:AgentDefinition"`; supply `target.id: UUID` with `AssistantAgentUpdateInput` when editing or omit it with `AssistantAgentInput` when creating | 204; no writes or Key preparation |
| PUT `/agent-definitions/:agentId` | `AssistantAgentUpdateInput` | `AssistantAgentDefinition` |
| DELETE `/agent-definitions/:agentId` | — | 204; existing history remains readable |
| POST `S/export/ppt` | `{}` | PPTX from runtime history and accepted datasets |
| GET `F/dataset-source` | — | `AssistantDatasetSource`; generic file: 404 |
| GET `S/feedback` | optional runId | `AssistantFeedbackList` |
| PUT `S/feedback` | `AssistantFeedbackWrite` | `AssistantFeedback` |
| DELETE `S/feedback/:feedbackId` | — | 204 |

Definitions contain one systemPrompt, one skills list, modelSelection, name, description,
icon, enabled, classNames, enabledMcpServiceIds, sortOrder and executionUserId.
Omitting `sortOrder` creates a definition at 0 or preserves an existing definition's
stored order. An explicit integer is written as supplied. An update that omits
`skills` preserves the current selection without validating it. An explicit
array replaces the selection, including an empty array to clear it. The owner
refuses the entire replacement if the caller cannot see an existing active
skill reference. Creation requires the `skills` array. The settings panel
leaves sorting outside its form and writes the complete remaining values.
The execution user is a nullable domain user ID: null uses the initiator. Creation
defaults to null; omitted updates preserve the stored reference. Java authorizes
changes with the original operator credential and domain administrator permission.
Validation reads the real old definition and prepares no Key. Saves validate all
settings before preparing a selected user credential; Node stores only its ID. Both presets are ordinary
editable definitions. The common `/agents` endpoint exposes only selector metadata,
never the prompt or these business settings. Deleted definitions do not delete
history, and cannot admit new runs. Old executor/dimension/report/summary/hot-report
fields are rejected and are not read from legacy definition rows.

Each run fixes its nullable executionUserId. Self mode keeps the initiator's original credentials;
a selected user uses their current shared Key through the existing internal resolver. Runtime/provider
transport contains only executionActor references, never executor credentials. Same-run steer and
followup keep the selection; an idle wakeup creates a new run and reads the current definition.
Sessions, files, notifications, feedback and page-skill filtering remain with the initiator.
AgentProfile.agentId references the same Node definition, including its current execution setting;
profiles do not store a separate execution user or principal permission.

classNames scopes both the initial ontology context and retrieval, intersected with
the executor's authorized classes by ontology. graphScope is removed without
converting its old roots/depth into new query restrictions. External MCP selections are runtime-assigned
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

Feedback upserts one value per session/run/target; dislike requires a reason. A session
belongs to one user, so the stored rows are per user through their session.
The host validates target ownership and resolves question/output from runtime.
Accepted copied datasets must match their original receipt/digest; dataset-source
returns the original retrieval/artifact IDs and the existing optional QC result.
QC refresh is independent of the assistant stop. Dashboard create/add uses
[dashboard-artifacts](src/dashboard-artifacts.ts) references instead of checkpoint
indexes. Scheduled execution remains disabled with stored data retained. Moving
feedback, QC annotations and decisions into runtime is outside this batch.

## Ontology retrieval cutover

The [ontology retrieval contract](data-retrieval.md) replaces workbench
retrieval orchestration, and the [agent runtime contract](agent-runtime.md) owns
generic channel delegation, delivery notifications, reads and cancellation. The
assistant retains parent associations and dataset provenance, using ontology HTTP
for metric recall/execution, formal datasets and QC. Its dataset-source shape above
is unchanged. The assistant mounts `ontomato-analyst-assistant`, which documents
only the ontology metadata commands, `start-retrieval` and `run-metric`; external,
retriever and generation execution use the complete `ontomato-analyst`.
`assistant-retrieval` is removed. This cutover does not extend the common host
proxy or move feedback into runtime.
