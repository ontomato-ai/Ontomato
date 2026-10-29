# Business knowledge governance in the ontology service

Governance keeps its existing name and report-only behavior. The ontology service owns its
agent definition, standard skill, work records and run write gates. The Manager hosts the
conversation using `agent-shell-ui`; the workbench governance module and routes are removed.
Other administration pages are unchanged.

## Interfaces and ownership

- The existing `/ontology/ai` agent-host interface lists, creates, reads, streams, cancels and
  deletes governance conversations. Agent ID: `56a15178-ae22-4e6f-9974-ababeb42a676`.
- `/ontology/ai/knowledge-governance/:sessionId/work` and `/sources/:sourceId` expose the saved
  work and its source material to the initiating user in the credential's domain.
- The standard `agent-skills/knowledge-governance` package calls the ontology service directly.
  `/skill-runs` admits external work with an idempotency key; it does not start a runtime agent.
  Product runs receive a scoped `knowledge-governance` grant valid only for their action routes.
- Existing `business-knowledge` permission is checked by the ontology identity implementation.
  The session owner and domain are checked for every UI and external-skill operation.
- `ontology_governance_sessions` holds the latest work-run reference;
  `ontology_governance_work` holds each run's work. Existing `ontology_agent_sessions/runs`
  own conversation identity and write eligibility. A session lock serializes successor creation
  and work changes; every mutation also locks and checks its run, expiry and latest-run pointer.
  Stop closes writes before cancelling the runtime admission intent. Terminal observations close
  the gate. Failed admission seals the original intent, including a lost HTTP acknowledgement.
  Reads that register sources pass the same write gate after obtaining external material.
- Manager routing is `/knowledge-governance/:sessionId?`, reached from business knowledge.
  Its report includes review progress, findings, statuses and original-text source reads.
  Leaving the page detaches the stream; only Stop cancels execution.

## Runtime history

`GET /v1/history` accepts `agentId`, `from`, `to`, `query`, `offset` and `limit` (1–100).
The verified `X-Domain-Id` is always enforced. Time is run creation time, `from` inclusive
and `to` exclusive. Keyword matching covers user input and the final answer before pagination.
The response contains `records` and `nextOffset`.

Each record contains `hostId`, `runId`, `sessionId`, nullable `agentId`, timestamps,
`question`, nullable `answer`, and registered artifact metadata. A final answer is the text of
only the last assistant message of a run stopped with `stop` or `length`, provided it has no
pending tool calls. Thinking, intermediate assistant text, tool messages, definitions, prompts,
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

## Delivery boundary

No old records are converted or dropped. The removed workbench schema creators do not touch
existing tables; release conversion must migrate those records before a release claims continuity.
Main-directory full-stack/model/browser acceptance remains with the controller: read knowledge,
read ontology, find a workbench question in runtime history, save/reopen work, and stop a run.
