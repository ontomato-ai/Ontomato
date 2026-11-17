# Knowledge governance in the agent platform

Node owns the ordinary assistant definition (`assistant_agents.kind=knowledge-governance`),
its modelSelection, conversation index and provider lifecycle. Java owns governance records,
sources, recommendations, knowledge import and write eligibility. The ontology namespace
still owns and publishes the standard knowledge-governance skill; it no longer owns a
conversational governance definition or model selection.

## Interfaces and ownership

- Ordinary assistant APIs and the existing workbench provider create and run governance.
  Governance preparation uses the same platform prompt/environment assembly as ordinary
  assistants, without ontology query context, Action catalogue or a retrieval scope.
  It requires business-knowledge access, without adding a query permission requirement.
- `POST /api/assistant/sessions/:sessionId/governance-window` is a run-scoped callback.
  It accepts only optional `recordId`. Node verifies the authenticated initiator, the
  persisted current/admitted turn, live runtime status and access to a selected record.
  A signed existing callback credential supplies the run identity; headers alone cannot.
- Java `POST /ontology/ai/knowledge-governance/platform-windows` registers the trusted
  `{recordId,domainId,ownerId,runtimeHostId,sessionId,runId,expiresAt}` binding and returns
  the existing scoped governance grant. Registration requires both workbench service
  authentication and the current initiator credential. Expired credentials fail.
  Records are created only when the skill requests a window.
- Java `GET .../platform-windows/:runId` returns the record reference; `POST
  .../platform-windows/:runId/close` closes it. Both require service authentication.
  `POST .../skill-package` publishes the capability-owned skill with the same service boundary.
- `GET .../:recordId/work`, `GET .../:recordId/sources/:sourceId`, and existing
  `POST .../:recordId/runs/:runId/actions/:action` retain the data-service ownership rules.
  `GET .../access` projects the authenticated owner/domain/credential expiry for Node.
- Every platform action checks the bound run via service-authenticated Node
  `GET /internal/assistant/sessions/:sessionId/runs/:runId/status`. Node resolves its own
  persisted ownership, reads the existing runtime lightweight status and returns only
  `{sessionId,runId,status,stopReason}`. Java uses no workbench runtime credential.
  A non-running run or failed status read refuses the action. The existing write
  transaction then locks and checks record ownership, latest window, expiry and closure.
- Node closes windows on provider settle/cancel and failed admission. Explicit stop
  closes the Java gate before requesting runtime cancellation. Status checks also
  reject late writes if a close notification has not arrived. No governance poller or
  second running-state store is introduced.
- External `/skill-runs` begin and `/:recordId/skill-runs/:windowId/close` use current
  user credentials and a separate external window, without creating a runtime run.
  External close cannot close a platform window. Expiry and latest-window rules apply.
- Platform read-input reads the first user question through existing runtime history,
  storing a history source reference, title and empty excerpt; source reads resolve it
  again through history. Later steered user messages are outside this batch. External
  begin material remains attached to its external window.
- Provider process/results use `/governance/reports/:recordId` when a record exists;
  governance never uses an inline live model process. Scheduling now selects the ordinary
  governance definition in the agents adapter; the old governance scheduling declaration
  and Java executor are removed.

## Storage

`ontology_governance_records` owns record ID, owner/domain, latest window and revision.
`ontology_governance_windows` owns window ID, record reference, external/platform identity,
expiry and closure. Platform rows bind the real host/session/run; only external rows store
begin material. `ontology_governance_work` retains per-window work snapshots, with the old
`ontology_agent_runs` foreign key removed. New governance data has no dependency on Java
host sessions/runs and stores no conversation title, platform input message or running state.

## Runtime history

`GET /v1/history` accepts `agentId`, `from`, `to`, `query`, `offset` and `limit` (1–100).
The verified `X-Domain-Id` is always enforced. Time is run creation time, `from` inclusive
and `to` exclusive. Keyword matching covers user input and the final answer before pagination.
The response contains `records` and `nextOffset`.

Each record contains `hostId`, `runId`, `sessionId`, nullable `agentId`, timestamps,
`question`, nullable `answer`, and registered artifact metadata. A final answer is the text of
the message the runtime named as the run's `answerMessageId`, and null when it named none
(see [the runtime contract](../packages/contracts/agent-runtime.md#pi-state-and-history)). Thinking, intermediate assistant text, tool messages, definitions, prompts,
credentials, feedback, decisions and quality annotations are excluded. Run annotations are deferred.

`GET /v1/history/:hostId/:runId` returns the same projection.
`GET /v1/history/:hostId/:runId/artifacts/:artifactId/content` reads an artifact belonging to
that projected run. Both routes enforce the same domain and host policy as search.

Hosts normally read only their own history. The deployment/development host configuration grants
`domainHistory: true` to the ontology host alone. The existing full snapshot, event, artifact and
write endpoints remain host-scoped; the new permission applies only to the history endpoints.
Agent identity is opaque `definition.agentId` stamped by host definitions. Old runs without it
return null and do not match an agent filter; backfill belongs to release conversion.

`search_history`, `read_history`, `read_evidence` and `collect_turn_artifacts` use these interfaces.
They do not call the workbench or collect diagnostic files. Explicit artifact reads support text
and JSON, with the existing character pagination and traceable source registration.

## Delivery boundary and legacy data

The frontend batch still needs to remove the old shell, history/feed and model page and
assemble the report route. This backend batch changes no Vue or frontend package.

No legacy conversations or tasks are converted or deleted. Old ontology-host governance
sessions/runs, `ontology_governance_sessions`, old work rows without new windows,
`ontology_governance_agents`, governance rows in `ontology_agent_settings`, and associated
ontology-host runtime conversations remain legacy data for release conversion. Old Java
governance IDs are no longer admitted or readable through the conversation host.

Existing `application_id=governance` scheduled tasks lose their adapter. On dispatch or
settlement the scheduler reports `application_unavailable` and pauses the task, rather
than silently ignoring it. No old execution path is retained.

Platform import-knowledge still calls Java in this first backend batch. Its page-draft
conversion waits for the controller to integrate page-drafts/page-skills and authorize
stage two. Full-stack/model/browser acceptance belongs to the controller on 128.
