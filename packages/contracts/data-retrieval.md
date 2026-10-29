# Ontology data retrieval contract

Implemented in slice A, 2026-10-29. Ontology owns retrieval; shared schemas are in
`src/data-retrieval.ts` and Java validates the same boundary.
[Design](../../docs/data-retrieval-design.md) owns the cutover; [runtime](agent-runtime.md)
owns messages, PI state and immutable files.

## One public retrieval service

All paths are on **ontology**, relative to its API base. Authentication supplies
user/domain; every operation checks both. Foreign IDs return 404. The shared
`ontomato-analyst ask` calls this service inside/outside the product. Remove
workbench `/api/retrievals` entirely.

| Method/path | Shape / meaning |
| --- | --- |
| POST `/ontology/retrievals` | UUID Idempotency-Key; existing `RetrievalInput`; 202 `RetrievalSnapshot` |
| GET `/ontology/retrievals/:id` | Current snapshot |
| POST `/ontology/retrievals/:id/answers` | New UUID key; existing `retrievalAnswersSchema` (`expectedRunId`, `expectedDecisionRevision`, `message`); 202 snapshot |
| POST `/ontology/retrievals/:id/cancel` | `{}`; close business writes before cancelling active output/QC work and runtime intent/run |
| GET `/ontology/retrievals/:id/datasets/:artifactId` | `{id,payload:DatasetPayload}` for an accepted immutable dataset, including historical rounds |
| GET `/ontology/retrievals/:id/runs/:runId/evidence` | `{input:RetrievalInput,snapshot:RetrievalSnapshot}` for that exact owned round; QC comes from its Java job |
| DELETE `/ontology/retrievals/:id` | 204; active run 409. Delete the owned business record and runtime session through their owners |

Preserve messages, `running/stopped`, stopReason/errorMessage, runtime IDs,
datasetArtifactIds and revisions. Questions stop normally; replies share the
session. No needs_input/business completion enum. The common [host proxy](ontology-ai.md)
supplies detailed history/events and original artifact bytes. Workbench cannot
read them with its own runtime service key. Failed reads are explicit errors.

Matching creation/reply retries recover the original intent/run, including after
uncertain admission. Changed input, active/superseded rounds or stale decisions
return 409. Java records decisions with the intent, without rewriting historical
files or moving them into runtime. Reconcile persisted IDs after restart; transport
failure does not change PI state. Read terminal facts before applying deadlines.

Approved deadline (D3): optional integer `timeoutSeconds` from 1 through 600 on
creation/continuation, snapshotted by Java, defaults to 600 seconds. A caller scope can shorten it.
Workbench retains queryTimeoutSeconds for its parent and supplies the remaining
deadline. Java does not read workbench configuration.

## Formal files and external skills

Provider `ontology` publishes both analyst and data-retrieval. The dataset command
remains `node skills/data-retrieval/scripts/dataset.mjs @work/recipe.json outputs/result.dataset.json`.

`POST /ontology/retrievals/:id/runs/:runId/outputs` takes existing
`prepareDatasetSchema` and UUID Idempotency-Key; returns 202 `{id}`.
`GET .../outputs/:id` returns `{id,running,dataset,error}` as before;
`GET .../outputs/:id/content` returns the ready dataset JSON as original bytes,
so the script need not parse and rewrite numbers. These are
formal-execution receipts, not agent outcomes. Persist the request key beside the
recipe before posting; atomically rename returned data into outputs.

Java checks the current/open run before output admission and receipt acceptance,
and invokes its formal-output service locally for a fresh execution under user
permissions. Preserve source/digest, parameters, source-column agreement, masking
and truncation; exploration rows are not formal results. Unknown effects reconcile
the original ID. Closed/old runs return 409 `RETRIEVAL_RUN_CLOSED`; committed
receipts stay readable. Cancellation closes pending outputs before stopping work.

Metric recipes optionally select an owned `bindingId` on the dynamic `metricId`.
Execution resolves the stored binding values, rejects overrides and freezes the
actual values in the returned recipe. Metric revisions include the current
aggregate; a changed definition or binding requires retrieving it again.

`DatasetPayload` remains the sole dataset schema. Keep `workbench.dataset.v1`
as the existing wire format identifier in this ownership-only change. Java
verifies receipt ownership/digest against immutable registered bytes. A receipt
without a file publishes nothing; edited files stay generic. Latest accepted
occurrence per path forms current output; historical IDs remain and inherited
files are not attributed to a new run. Runtime owns bytes; Java stores references
and receipt metadata, not another permanent copy of rows.

External `POST /ontology/retrievals/skill-runs` and
`POST /ontology/retrievals/:id/skill-runs/:runId/close` keep existing begin/close
inputs and `{id,sessionId,runId,expiresAt}`. Use the same business gate/output
service without a runtime agent or synthetic history. External snapshots have
null runtime IDs/run and empty messages. External work uses normal user authority;
in-product retrieval issues its exploration grant locally.

Scripts use `ONTOMATO_ONTOLOGY_URL`, **`ONTOMATO_TK` as current user credential**,
`ONTOMATO_RETRIEVAL_ID`, runtime session/run identity, language/correlation/output
variables. Direct query/Python commands retain `ONTOMATO_QUERY_TK` and
`ONTOMATO_QUERY_RUN_ID`. No callback credential replaces ONTOMATO_TK. Retrieval
stops consuming ONTOMATO_WORKBENCH_URL; other workbench skills retain their own
configuration. Environment precedes external application.yml. Ask downloads
accepted bytes through the ontology proxy; the retriever uses direct queries and
dataset.mjs rather than recursive ask.

## Assistant caller scope

Approved and implemented boundary (D1): workbench owns parent meaning;
Java owns an opaque caller admission scope. Runtime gains no parent/child model.

| Ontology operation | Shape / meaning |
| --- | --- |
| POST `/ontology/retrieval-callers` | Existing service authorization plus verified end-user identity; UUID key; `{classNames,continuationIds,deadlineAt}`; return `{id,expiresAt}`. Persist before returning; identical retries replay, changed input conflicts. |
| GET `/ontology/retrieval-callers/:id` | Owned scope and accepted `{retrievalId,runId}` references for reconciliation; no duplicate transcript |
| POST `/ontology/retrieval-callers/:id/close` | Close admission/continuation atomically, then cancel still-active rounds bound to this scope; idempotent |

Workbench persists parent-run → caller ID before opening it. The single analyst
client forwards optional `ONTOMATO_RETRIEVAL_CALLER_ID` as
`X-Ontomato-Retrieval-Caller-Id` on retrieval operations. This ID is association
metadata, not a credential: normal tk verification and scope ownership are still
required. Java applies the scope's class/deadline restrictions; request fields
cannot widen them. Continuation is limited to this scope's children or the
validated continuationIds supplied by workbench for the same assistant session.
No script calls a workbench retrieval route. Workbench stores only the association
in `assistant_turns.retrieval_scope_id` and asks Java for child references.

Workbench evidence reads carry existing service authorization, domain and caller
ID. Java derives the owner from the stored caller and verifies the requested
session/run is linked to it. This retains existing domain-authorized diagnostic
and governance history access without accepting arbitrary user claims or sharing
the ontology runtime credential. Ordinary reads still verify the user's credential.

Admission and continuation lock/check the caller scope and record the child round
association in the same transaction, before contacting runtime. Scope closure
serializes with that transaction; an accepted intent is cancellable even before
runtime admission completes.

Close also accepts a not-yet-open owned intent: retain a tombstone to prevent a
late open/admission. New rounds bind to their new caller; closing an older caller
cannot cancel a reassigned round. Already stopped runs and their asynchronous QC
remain intact. Workbench closes/reconciles on parent stop/cancel; Java never calls
back to workbench. External ask with a normal token needs no caller scope.
Exploration-grant issuance ceases to be a workbench API.

## QC and limits

Eligible stopped/stop runs with accepted datasets schedule existing Java QC once;
questions without datasets do not. Retain late QC, scoring/candidate rules and
stable job-ID recovery. Retrieval references the QC owner; workbench reads it as
evidence. Feedback/decisions do not move into runtime. Model configuration,
MetricView remodeling, general MCP, knowledge governance, stored-data conversion
and artifact retention stay outside this cutover.
