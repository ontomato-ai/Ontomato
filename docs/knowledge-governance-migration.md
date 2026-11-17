# Knowledge governance in the agent platform

Node owns the ordinary assistant definition (`assistant_agents.kind=knowledge-governance`),
its modelSelection, conversation index and provider lifecycle. Java owns governance records,
sources, recommendations, knowledge import and write eligibility. The ontology namespace
still owns and publishes the standard knowledge-governance skill; it no longer owns a
conversational governance definition or model selection.

## Interfaces and ownership

- Ordinary assistant APIs and the existing workbench provider create and run governance.
  Governance uses ordinary assistant preparation. The selected ontology query skill alone
  enables ontology overview/context and a retrieval scope; the predicate lives in skills.ts.
  The governance preset selects governance alone and therefore adds no query permission
  requirement. Kind identifies preset data, not a separate execution path.
- `POST /api/assistant/sessions/:sessionId/governance-window` is a run-scoped callback.
  It accepts only optional `recordId`. Node verifies the authenticated initiator, the
  persisted current/admitted turn and live runtime status. Java decides record ownership.
  A signed existing callback credential supplies the run identity; headers alone cannot.
- Java `POST /ontology/ai/knowledge-governance/platform-windows` registers the trusted
  `{recordId,domainId,ownerId,runtimeHostId,sessionId,runId,expiresAt}` binding and returns
  the existing scoped governance grant. Registration requires both workbench service
  authentication and the current initiator credential. Expired credentials fail.
  The platform deadline is turn.created_at + getQueryTimeoutMs(), also used by the callback
  credential; Java only shortens it to the current credential expiry. External begin keeps
  its own 600-second window. Records are created only when the skill requests a window.
- Java `POST .../platform-windows/:runId/close` closes the window using service
  authentication. Node saves only the returned record reference in its accepted turn.
  `POST .../skill-package` publishes the capability-owned skill with the same service boundary.
- `GET .../:recordId/work`, `GET .../:recordId/sources/:sourceId`, and existing
  `POST .../:recordId/runs/:runId/actions/:action` retain the data-service ownership rules.
- Every platform action checks the bound run via service-authenticated Node
  `GET /internal/assistant/sessions/:sessionId/runs/:runId/status`. Node resolves its own
  persisted ownership, reads the existing runtime lightweight status and returns only
  `{sessionId,runId,status,stopReason}`. Java uses no workbench runtime credential.
  A non-running run or failed status read refuses the action. The existing write
  transaction then locks and checks record ownership, latest window, expiry and closure.
- Node closes windows on provider settle/cancel. Explicit stop
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
  only a run with its own saved governance record uses that page rather than an inline process. Scheduling selects the ordinary
  governance definition in the agents adapter; the old governance scheduling declaration
  and Java executor are removed.

## Storage

`ontology_governance_records` owns record ID, owner/domain, latest window and revision.
`ontology_governance_windows` owns window ID, record reference, external/platform identity,
expiry and closure. Platform rows bind the real host/session/run; only external rows store
begin material. `ontology_governance_work` retains per-window work snapshots, with the old
`ontology_agent_runs` foreign key removed. New governance data has no dependency on Java
host sessions/runs and stores no conversation title, platform input message or running state.

Node assistant_turns.retrieval_scope_id is nullable and is assigned only after Java opens
that caller. Its governance_record_id is a nullable reference assigned only after Java
registers a window. Cleanup/evidence/continuations use these per-turn references; provider
page links use this run's own recorded governance reference. No current-kind or
current-skill lookup reconstructs a past round. Existing retrieval_scope_id values remain
unchanged. For an old caller that never existed, service-only close-scope is a successful
no-op, and links returns 404 handled by the existing deletion path.

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

Platform import-knowledge emits one business-knowledge PageDraft per item and links to
`#/ontology/knowledge` with the originating runtime session/run and draft path. It reads
existing knowledge using the current user credential, creates no governance window just
for drafting, and never calls Java import. New forms use an empty knowledgeID and status 0;
updates target the current knowledgeID and preserve its status and any omitted tags.
External imports still call Java. Java has no standalone side-effect-free knowledge
validation endpoint; none was added. The page batch owns reading/filling/saving these forms.
PageDraft target.id now accepts an opaque nonempty knowledge ID; non-UUID updates are
covered by the same contract test as creates. The ontology declaration maps the governance
report page to the knowledge-governance preset; business-knowledge keeps the ordinary default.
New and existing domains lazily receive their own stable governance preset.
PLATFORM_DRAFT_RULE remains later host work and is not duplicated in skill instructions.
Full-stack/model/browser acceptance belongs to the controller on 128.
