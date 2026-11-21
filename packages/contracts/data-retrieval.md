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
| GET `/ontology/retrievals/:id?runId=:runId` | Lightweight `RetrievalSnapshot`: stored state, the retriever's delivery, delivered `outputIds` and result cursor, never messages. Optional runId selects an exact owned round; omitted selects the current round |
| GET `/ontology/retrievals/:id/datasets/:datasetId` | `{id,payload:DatasetPayload}` for an accepted immutable dataset |
| GET `/ontology/retrievals/:id/datasets/:datasetId/content` | Original accepted bytes of the runtime artifact |
| GET `/ontology/retrievals/:id/runs/:runId/evidence` | `{input:RetrievalInput,snapshot:RetrievalSnapshot}` for that exact owned round |
| POST `/ontology/retrievals/:id/runs/:runId/quality` | Workbench service only: `{replyRunId,outputIds}`, the outputs of this round a finished reply cited; 202. See [answer quality](#answer-quality) |
| POST `/ontology/retrievals/:id/dataset-source` | `{receiptId,dataset}` → `{runId,outputId}`: which formal output these exact bytes are |
| DELETE `/ontology/retrievals/:id` | 204; active run 409. Delete the owned business record and runtime session through their owners |

Preserve `running/stopped`, stopReason/errorMessage, runtime IDs,
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
Workbench supplies the remaining deadline from its own turn deadline, a fixed ten
minutes. Java does not read workbench configuration.

## Retrieval as a task

A round is read as a [task](agent-tasks.md); the retriever's own run is shown through the task's
process routes. The round runs until the retriever's delivery is recorded and settles with it.
Runtime `agent_end` alone does not imply that the delivery has been recorded. These reads never
fetch runtime messages synchronously; the existing observer owns reconciliation. Evidence reads
remain side-effect free. Continuation admission still reconciles current runtime facts before
deciding whether another round can start.

Retriever delivery uses its accepted artifacts, and its `answer` is the text of the message the
runtime named as the run's `answerMessageId` (empty without one). Reads apply the same identity to
deliveries stored before the runtime named answers: their text counts only for a normal stop.
Cancellation closes pending outputs before stopping work and keeps accepted outputs.

## Answer quality

Delivery alone schedules no check. When a workbench reply ends normally, the workbench reads the
datasets its answer message cites (Markdown links and images to `.dataset.json` files, resolved as
the shell resolves them) and matches each file to its formal output by receipt and digest. For each
round it posts the cited outputs once. The caller header is the round's own caller; `replyRunId` is
the reply's caller of the same owner. Java freezes the check from the round's own record: question,
user quotes, confirmed decisions, class scope and the cited outputs' frozen recipes, nothing the
model wrote. The first adopting reply records `quality_adoption` on the round and owns its one
check; a later reply citing the same round keeps that check. A published metric is only checked:
candidates are generated for retriever packages, never for metric recipes.

The check and its candidates run under the reply's run, which holds its credential chain: the
workbench's provider read reports the reply unsettled until they end. `GET
/ontology/retrieval-callers/:replyRunId/quality` returns `{quality,qualityResults,settled}` for that
reply; the workbench places each check under the reply in its task projection. Java reports a
change of a reply's checks to the workbench (`POST /internal/assistant/runs/:runId/quality-changed`,
platform service credential, the reference only), and the workbench signals that run through its own
runtime host. A check that cannot be admitted does not change the finished reply.

## Formal files and external skills

Provider `ontology` publishes analyst and data-retrieval. New delivery uses
`node skills/data-retrieval/scripts/dataset.mjs deliver @work/q.json --meta @work/delivery.json`.
[Query packages](query-package.md) owns the file manifest, parameter bindings and
Python computation fragment. A plain DSL JSON is the one-file shorthand.

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

## Metric delivery

The assistant calls `start-retrieval` once with the complete question to
concurrently start the retriever through the active run's agent channel (using the
bundled `retriever-ref.json`) and recall published metric definitions from ontology
before potentially executing a formal metric. In its own retrieval run:
`POST /ontology/retrievals/skill-runs` with the question,
`POST .../runs/:runId/submit-metric` with `{id,revision,bindingId?,parameters?}`
and a UUID Idempotency-Key, the same status/content reads, then `close`. The
selector is the whole input: Java reads the published definition, the declared
defaults or the preset values, freezes the executed source and the receipt, and
generates the title from the definition and the question from the accepted
request. `bindingId` and `parameters` are exclusive; missing parameter values
come from the definition, and subject-bound values are resolved at execution.
A revision that changed is refused, and only a published metric is delivered.
`workbench.dataset.v2` metric files carry `recipe.kind="metric"` with exactly one
frozen source and `selfCheck:null`; they never carry metric uses.

Files written before the cutover may carry `metricUses` and a `selfCheck.comparisons`
list. A reader of an already stored file drops those two fields before applying
the current view; new submissions must not send them.

`DatasetPayload` remains the sole dataset schema. New outputs use
`workbench.dataset.v2` and freeze the complete package and actual parameter values;
metric outputs retain kind:metric plus their host-resolved frozen package.
Historical v1 files keep their exact original bytes and receipts and are decoded
only at the read boundary. New dsl/python recipe submissions are rejected. Java
verifies receipt ownership/digest against immutable registered bytes. A receipt
without a file publishes nothing; edited files stay generic. Latest accepted
occurrence per path forms current output; historical IDs remain and inherited
files are not attributed to a new run. Runtime owns bytes; Java stores references
and receipt metadata, not another permanent copy of rows.

External `POST /ontology/retrievals/skill-runs` and
`POST /ontology/retrievals/:id/skill-runs/:runId/close` keep existing begin/close
inputs and `{id,sessionId,runId,expiresAt}`. A normal close ends that run's write window only; its
delivered outputs stay checkable and nothing is cancelled. A run that outlives its deadline is closed
and cancelled by the observer. Use the same business gate/output
service without a runtime agent or synthetic history. External snapshots have
null runtime IDs/run and empty messages. External work uses normal user authority;
in-product retrieval issues its exploration grant locally.

Scripts use `ONTOMATO_ONTOLOGY_URL`, **`ONTOMATO_TK` as current user credential**
(or `ONTOMATO_EXECUTION_CALLBACK` with `ONTOMATO_RETRIEVAL_CALLBACK_URL` when a
selected execution user is configured), `ONTOMATO_RETRIEVAL_ID`, runtime
session/run identity, language/correlation/output variables. Runtime channel
credentials (`ONTOMATO_AGENT_COMMAND_URL` and `ONTOMATO_AGENT_CALLBACK`) are used
only for the active run's agent channel command route. Every process uses one
`ONTOMATO_TK`: agent calls carry a scoped user authority; Java injects a distinct,
short-lived execution tk into its Python job. The agent cannot select or receive
that internal credential. Environment precedes external application.yml. External
packages download accepted bytes through the ontology proxy; platform runs read
delivered files via the agent channel into `outputs/agents/`, and the retriever uses
direct queries and `dataset.mjs`.

## Assistant caller scope

Approved and implemented boundary (D1): workbench owns business associations and
reply adoption; Java owns data permissions, opaque caller admission scope,
retrieval admission and formal delivery; runtime owns generic `requestedBy/root`,
delivery and wakeup. Retrieval adds no retrieval-specific parent/child model to
runtime; delegation uses the existing generic agent channel.

| Ontology operation | Shape / meaning |
| --- | --- |
| POST `/ontology/retrieval-callers` | Existing service authorization plus verified end-user identity; UUID key; `{classNames,continuationIds,deadlineAt,recentUserMessages}`; return `{id,expiresAt}`. `recentUserMessages` is the host-supplied conversation context: the last ten user messages in chronological order, including the message that starts this turn, never model-written. Persist before returning; identical retries replay, changed input conflicts. |
| GET `/ontology/retrieval-callers/:id` | Owned scope and accepted `{retrievalId,runId}` references for reconciliation; no duplicate transcript |
| POST `/ontology/retrieval-callers/:id/close` | Close admission/continuation atomically, then cancel still-active rounds bound to this scope; idempotent |

Workbench persists parent-run → caller ID before opening it. The single analyst
client forwards optional `ONTOMATO_RETRIEVAL_CALLER_ID` as
`X-Ontomato-Retrieval-Caller-Id` on retrieval operations. This ID is association
metadata, not a credential: normal tk verification and scope ownership are still
required. Java applies the scope's class/deadline restrictions and uses the scope's
`recentUserMessages` as this retrieval's `userQuotes`, so the retriever sees the
user's own words instead of a model-supplied rewrite; request fields cannot widen
the scope. Continuation is limited to this scope's children or the
validated continuationIds supplied by workbench for the same assistant session.
Only the selected execution-user callback path (`ONTOMATO_RETRIEVAL_CALLBACK_URL`)
calls workbench's restricted retrieval proxy; scripts do not call workbench
retrieval orchestration, and the runtime channel credential (`ONTOMATO_AGENT_CALLBACK`)
only enters the runtime channel route. Workbench stores only the association
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
questions without datasets do not. The independent describer receives the whole
frozen package through the rule-based blind view; candidate generation receives
the original package and actual parameter values. QC compares the retrieved program against the
user's own messages plus the confirmed decisions recorded on the retrieval; when
no user messages are present it falls back to the retrieval question. A caller
scope's `recentUserMessages` become those messages for the retriever and QC.
Retain late QC, scoring/candidate rules and stable job-ID recovery. Retrieval
references the QC owner; workbench reads it as evidence. Feedback/decisions do not
move into runtime. Model configuration,
MetricView remodeling, general MCP, knowledge governance, stored-data conversion
and artifact retention stay outside this cutover.

Source analysis is the shared [query subgraph](query-subgraph.md). Java derives
DSL graphs from the frozen package, then composes the declared Python computation
fragment. Model metadata supplies only output labels, business self-checks and
metric-use explanations. The host supplies the admitted question and confirmed
decision IDs. Legacy stored sources remain read-boundary compatibility.
`dataset.mjs preview @query.json --meta @delivery.json` executes under the same
permissions; identical preview/delivery inputs reuse their execution key. No
preview or extra model round is required before deliver.
