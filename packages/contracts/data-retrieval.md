# Standard-skill data retrieval contract

Design for controller review, 2026-10-28; executable schemas change in segment 2.
This replaces the batch 2 private submission/finish protocol. The workbench owns
retrieval orchestration; ontology owns authorization and formal execution; runtime
owns messages, PI state and file snapshots. [Design](../../docs/data-retrieval-design.md)
explains flow and external-agent acceptance. [Runtime contract](agent-runtime.md)
owns generic files and events, not this dataset schema.

## Public retrieval API and continuation

Verified workbench identity supplies user and domain. Resource lookups check both;
foreign IDs return 404. No public body can claim parent, user or domain identity.
The existing abc harness branch and external ask call this one service.

| Method/path | Input / output |
| --- | --- |
| POST /api/retrievals | UUID Idempotency-Key; `{question,userQuotes,classNames?,previousDatasetIds,interaction}`; 202 snapshot |
| GET /api/retrievals/:id | Authoritative snapshot |
| POST /api/retrievals/:id/answers | New UUID key; `{expectedRunId,expectedDecisionRevision,message}`; 202 snapshot |
| POST /api/retrievals/:id/cancel | `{}`; closes the business gate before runtime intent/run cancellation |
| GET /api/retrievals/:id/datasets/:artifactId | Validated dataset JSON read from the immutable file |

```ts
type RetrievalSnapshot = {
  id: UUID; revision: number;
  runtimeSessionId: UUID | null; runtimeRunId: UUID | null;
  run: null | {status:"running"|"stopped"; stopReason:PiStopReason|null;
               errorMessage:string|null};
  messages: RuntimeMessageRecord[];
  datasetArtifactIds: UUID[];
  decisionRevision: number;
  qualityCheck?: JsonObject;
};
```

For an external skill-run record, runtime IDs and run are null and messages is
empty; the host does not create synthetic runtime history.

There is no RetrievalResult, needs_input enum, structured question/choice result,
finish submission or requirement that ordinary stopping must produce a dataset.
Asking a question is a normal assistant message with stopReason stop. Public
callers display it, and send a free-text reply to the same retrieval/session.
No agent process remains alive waiting for the reply. Non-interactive callers
receive that message and available artifacts; silence does not authorize a
choice. Missing data does not itself make the run an execution error.

Creation fingerprints its inputs; answer fingerprints message, expected run and
decision revision. An active/superseded round or stale revision returns 409.
Store the user reply and its source run as a workbench decision fact in the same
admission-intent transaction. Retain effective decisions and supersedes links for
existing callers; free-text replies have task scope and user source, without
inventing question/choice IDs. Changes invalidate superseded decisions for future
runs, never edit historical files. No automatic knowledge publication is added.
The host injects effective decisions and prior artifact references into the next
run with fresh environment values. Moving decisions into runtime is deferred.

Transport/unavailability errors do not manufacture a PI state. Retain the last
observed state and retry reads; after a host restart reconstruct observation from
stored runtime references. An authoritative stopped snapshot closes the gate,
then publishes that same state. Runtime recovery is aborted, not a separate host
failed outcome. Read terminal facts before enforcing the existing query deadline.
If still running at its deadline, close the gate and cancel; this is a host query
deadline, not a new runtime budget. A missing authoritative resource is an explicit
HTTP/dependency error, never empty success. Keep parent admission/cancel gates,
run-intent tombstones and matching-key recovery after response loss.

The abc adapter consumes available authorized datasets through the existing
projection. It uses PI errors/aborts as execution failures in its existing branch
contract; a normal text question with no dataset remains text/no data, not an
invented retrieval state. Automatic next-chat-message routing and structured UI
interaction belong to batch 3. Public ask supports explicit same-session resume.

## Files and formal-output preparation

The standard data-retrieval skill exposes one ordinary CLI command:

```sh
node skills/data-retrieval/scripts/dataset.mjs @work/recipe.json outputs/result.dataset.json
```

It reads a recipe file, requests authorized final execution from the host, writes
the returned dataset to a temporary file outside outputs, and atomically renames
it to the requested output. It prints a bounded count/schema summary and path.
The runtime then registers the file exactly as it does any other output. No tool
result envelope, runtime artifact RPC or finish call is involved. The same command
runs in Claude Code from an unmodified package.

Host endpoints for this command:

| Route | Semantics |
| --- | --- |
| POST /api/retrievals/:id/runs/:runId/outputs | UUID Idempotency-Key; `{recipe,title,question,outKeyRefs,assumptions,decisionIds,metricUses,selfCheck}`; 202 `{id}` |
| GET /api/retrievals/:id/runs/:runId/outputs/:id | `{id,running:boolean,dataset:DatasetFile|null,error:null|{code,message}}` |

These are formal execution receipts, not agent completion states. The CLI keeps
its generated request UUID next to the recipe in work/ before posting; retrying
the same bytes reuses it. Changed recipe bytes require a new key. Host persists
identity and Java submission ID before calling Java. Check user/domain/retrieval
and the active run gate before admission, and again in the transaction that
accepts a returned receipt. Unknown response reconciles that ID; do not blindly
resubmit a possibly executed operation. Closed/old run returns 409
RETRIEVAL_RUN_CLOSED. Already committed receipts remain readable by the owner.
Cancel closes pending output intents and Java jobs along with the run gate.

The host sends the recipe and source declarations to existing
POST /ontology/query/outputs using the verified user's authority. Java always
reruns in a fresh workspace with current user permissions, validates sources,
parses output, applies masking and derives truncation. Exploration rows are never
accepted as formal result rows. Python recipes carry their source bytes/digest,
not a python_execute receipt. Remove the old requirement to find a matching
special-tool execution: it no longer exists with ordinary bash. Syntax/source
validation and a real formal rerun remain. This does not prove arbitrary generated
program lineage or prevent hardcoded answers; model correctness still needs real
question acceptance.

```ts
type DatasetFile = {
  schema: "workbench.dataset.v1";
  title: string; question: string;
  columns: {key:string; label:string; type:string|null}[];
  rows: Record<string,JsonValue>[];
  recipe:
    | {kind:"dsl"; dsl:JsonObject; executedCode:string; sha256:string}
    | {kind:"python"; code:string; sha256:string}
    | {kind:"metric"; metricId:string; revision:string; parameters:JsonObject;
       executedCode:string; sha256:string};
  outKeyRefs: {key:string; className:string; attrName:string;
              asGroupBy:boolean; statCal:boolean}[];
  truncation: null | {truncated:true; rowLimit:number; truncationHint:string};
  assumptions: string[]; decisionIds: UUID[];
  metricUses: {id:string; revision:string; use:"direct"|"derived"|"not_used";
              reason:string}[];
  selfCheck: {scope:string; filters:string; grain:string; denominator:string;
             nullGroups:string; comparisons:{metricId:string; comparable:boolean;
             explanation:string; executionRef:string|null}[]};
  execution: {receiptId:UUID; executedAt:string};
};
```

The dataset has no artifact ID inside it: the runtime assigns that after writing.
Preserve the existing columns/rows/source/masking semantics, including null,
false, zero, empty strings, nested values and empty-but-partial results. Column
keys and declared source keys must agree. Java owns these rules; neither model
nor Node guesses completeness from row count. Partial inputs stay partial after
Python aggregation. Metric recipes preserve exact revision, parameters and
executed source. Detailed schema is owned once by contracts; the standard skill
reference describes it without requiring an installed contracts package.

Workbench computes a canonical dataset digest from the formal receipt and stores
only receipt metadata/digest and later artifact ID, not another permanent copy
of rows. On artifact_registered or snapshot reconciliation it reads *.dataset.json
through the runtime content endpoint, validates schema, checks that receipt is
owned by that retrieval/run, and compares the canonical digest. A forged or edited
file remains a generic runtime file; it is not exposed as an accepted dataset.
A receipt alone never publishes a dataset. If the script dies before the file is
registered, do not manufacture publication from its successful HTTP call.

Within a run, expose the latest accepted artifact for each output path at the
observed cursor, ordered by first path appearance. Overwrites retain old IDs for
historical references. Only changed outputs belong to a new run; inherited files
remain prior references. Live/history/download/abc all use one file-to-dataset
projection. Full rows are fetched on demand, never copied into token events.
The generic file endpoint is still a file endpoint, not a claim that arbitrary
files satisfy the formal dataset contract.

## Skill environment and ontology APIs

The skill packages document these exact environment variables:

| Variable | Meaning |
| --- | --- |
| ONTOMATO_ONTOLOGY_URL | Ontology base URL including gateway prefix when applicable |
| ONTOMATO_WORKBENCH_URL | Workbench base URL, before /api |
| ONTOMATO_TK | Normal user or host-issued callback credential, sent as tk |
| ONTOMATO_QUERY_TK | Optional ontology query/execution credential, sent as tk; defaults to ONTOMATO_TK |
| ONTOMATO_SESSION_ID / ONTOMATO_RUN_ID | Runtime identity in product; host-issued work identity for external execution |
| ONTOMATO_RETRIEVAL_ID | Workbench retrieval record used by dataset.mjs |
| ONTOMATO_GOVERNANCE_ID | Workbench record used by governance scripts |
| ONTOMATO_LANGUAGE / ONTOMATO_CORRELATION_ID | Request language and trace correlation |
| ONTOMATO_OUTPUT_DIR | Output directory; external default is ./outputs |

All enabled skills use the one run environment. URLs/configuration resolve from
environment first; application.yml is a fallback outside product execution.
ONTOMATO_URL retains the external deployment-base fallback. The packages require
no product checkout. Scripts use documented variables directly, not
ONTOMATO_CONTEXT_JSON or a credential JSON envelope. The normal external token
is sufficient for ordinary authorized queries. Public anonymous identity remains
an explicit installed product policy. Signed query credentials are still issued,
verified, expired and revoked by Java for the existing bound run/domain/purpose;
only their transport is aligned with the scripts' documented tk header.

ontomato-analyst has a single ontomato.mjs/client.mjs CLI and Python helper:

| CLI command | Existing ontology facade endpoint |
| --- | --- |
| dataset-desc / classes | GET /ontology/query/overview |
| schema / relationships | POST /ontology/query/schema |
| dsl-reference | POST /ontology/query/dsl-reference |
| distinct-values | POST /ontology/query/distinct-values |
| execute-dsl | POST /ontology/query/execute-dsl |
| metrics | POST /ontology/query/metrics/search |
| execute-metric | POST /ontology/query/metrics/execute |
| knowledge | POST /ontology/query/knowledge/search |

Keep class-specific grammar, single-object DSL input (despite one-item-array
examples), nullable Java fields, published metric spec/revision checks,
model-free metric search and knowledge's existing Embedding retrieval. No business
example injection or model-based parameter filling is reintroduced. Python uses
the same helper as [standalone execution](agent-runtime-code.md).

The external ask command remains a workbench API client. The product retriever's
prompt instructs it to use direct ontology commands and dataset.mjs, not ask its
own orchestration service recursively. No second internal analyst entry remains.
Enterprise distributions generate shared executable files from the public source;
localized documentation/login convenience can remain edition-owned, but an
explicit environment token takes the identical command path in every edition.

## External work identity and business writes

Proposed addition requiring controller review: each workbench skill can open a
host-owned work record for an external harness without starting a runtime agent.
POST /api/retrievals/skill-runs takes a UUID key and the same question/class scope;
returns `{id,sessionId,runId,expiresAt}`. POST
/api/retrievals/:id/skill-runs/:runId/close closes its gate idempotently. Scripts
`begin`/`close` document these calls and emit values the external caller can set
as environment variables. End-user auth and query permissions are mandatory.

The existing product path and this entry call the same per-run gate/receipt
service. Internally the work ID is mapped to the actual runtime ID; externally
there is no fabricated runtime history. The external gate expires at the existing
query deadline, and an expired gate cannot be reopened by retry. Local files are
the external harness's outputs; no upload back to runtime is required to prove
portability. This is business work ownership, not another loop or agent protocol.
Governance uses the equivalent boundary described in the runtime design.

All mutations check the host-owned run gate in the mutation transaction, including
source registration on reads. Close before cancellation or opening a newer round;
serialize both with writes. The accepted guarantee begins at host closure.
An in-flight request before closure can affect only its own run record, never the
next round. No runtime-status HTTP call replaces that transaction.

## Quality checks and retained behavior

After a stopped/stop run has accepted datasets, schedule the existing Java
query-quality-checks job once with the final recipes and artifact IDs. A question
with no dataset starts no QC job. length/error/aborted never imply successful
completion; already published files remain available. QC stays asynchronous,
retains descriptions/score/fitted question/candidate rules, and cannot overwrite
a later round or mutate an immutable file. Matching job retries reuse its ID;
unknown candidate-creation effects are not replayed. QC's own existing job state
is not an agent run state. Moving QC/feedback/decisions into runtime is deferred.

Preserve `/ontology/query/outputs` and its scoped polling/cancellation contract,
QueryGrantService/QueryAccessService ownership, run-bound grants and all existing
formal permission checks. Update Java's RuntimeCodeClient and all code-execution
consumers for the generic process shape in the code contract. Keep LangGraph,
static/hot/traditional branches, existing Java generators and their Python HTTP
client until their named later migrations.
