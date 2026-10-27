# Data retrieval contract

The workbench's executable schemas are in `src/data-retrieval.ts`.
Runtime additions are in [agent-runtime-code.md](agent-runtime-code.md); ownership
and migration decisions are in [the design](../../docs/data-retrieval-design.md).
Java owns and validates its HTTP boundary; it does not import workbench code.

## Workbench entry point

The workbench owns one retrieval orchestration service. The `abc` branch in
`harness` mode calls that service directly. External `ask` and the workbench's
future retrieval skill call its HTTP API. Neither calls a Java agent or a runtime
model endpoint directly. A question means one complete business calculation;
splitting it into datasets is the retriever's responsibility.

All routes require the workbench's verified request identity. Domain and user
come from that identity, never the JSON body. Every lookup checks both ownership
and domain. Public anonymous identity follows the installed public identity
provider; it is not a bypass in enterprise. Foreign resources return 404.

| Method/path | Input | Output |
| --- | --- | --- |
| `POST /api/retrievals` | `Idempotency-Key: UUID`; `{question, userQuotes: string[], classNames?: string[], previousDatasetIds: UUID[], interaction: "resumable" | "non_interactive"}` | 202 retrieval snapshot |
| `GET /api/retrievals/:id` | Verified identity | 200 authoritative snapshot |
| `POST /api/retrievals/:id/answers` | New `Idempotency-Key`; `{expectedRunId, expectedDecisionRevision, answers: [{questionId, choiceId?: string, text?: string}]}` | 202 snapshot for the new runtime run in the same runtime session |
| `POST /api/retrievals/:id/cancel` | `{}` | 200 snapshot after business closure and cancellation requests settle |
| `GET /api/retrievals/:id/datasets/:artifactId` | Verified identity | Validated `workbench.dataset.v1` artifact with full rows |

Creation fingerprints question, source references, interaction mode and class
scope. A matching retry returns the original operation; changed input returns
409. Resume additionally fingerprints its previous run, decision revision and
answers. Resume against an active or superseded round returns 409, never forks a
second retriever. HTTP validation/auth/dependency failures use real status codes
and `{error:{code,message},correlationId}`. An accepted operation's business
failure is a result, not an empty successful response.

```ts
type RetrievalSnapshot = {
  id: UUID;
  revision: number;
  runtimeSessionId: UUID;
  runtimeRunId: UUID | null;
  phase: "running" | "settled";
  result: RetrievalResult | null;
  datasetArtifactIds: UUID[];
  decisionRevision: number;
  qualityCheck?: JsonObject;
};
type RetrievalResult =
  | { status: "completed"; datasetArtifactIds: UUID[]; summary: string }
  | { status: "needs_input"; datasetArtifactIds: UUID[];
      questions: InputQuestion[]; summary: string }
  | { status: "failed"; datasetArtifactIds: UUID[];
      error: { code: string; message: string } };
type InputQuestion = {
  id: UUID; question: string; reason: string; scope: string;
  choices: {id: string; label: string; consequence: string}[];
  recommendedChoiceId: string | null;
};
```

`phase` is transport/lifecycle information, not a fourth business outcome.
`completed` needs at least one accepted dataset and an explicit validated finish
submission. Zero rows are a valid dataset. Incomplete source coverage is retained
on the dataset; completed execution is not proof of complete source coverage or
correct business meaning. Unresolved material ambiguity always yields
`needs_input`, including non-interactive callers without an authorized default.
Available datasets remain available in that outcome; it is not complete success.
Silence does not accept a recommendation. Cancellation, interruption, timeout and missing submissions are `failed` with
stable distinct codes. Authentication/dependency failures retain their safe
reason and cannot become an empty successful result.
Runtime `completed` without a valid business submission is `failed` with
`RETRIEVAL_RESULT_MISSING`.

Public GET polling is sufficient for `ask` (currently at 500 ms intervals). The abc adapter
consumes runtime snapshot/events through the existing runtime HTTP client and
projects progress into current workbench events. No second durable token stream
or new public SSE journal is introduced for polling clients.

The parent turn/task ID is server-only. The authenticated server-side caller
validates its ownership and stores it before admission; model/public JSON cannot
claim an arbitrary parent. The abc adapter links the retrieval to its server-side turn/task before admission.
The public API/ask use a caller UUID admission key for response-loss retries.
A future main-assistant skill must map its tool call to that key at its own
admission boundary; that skill routing belongs to batch 3. The runtime has
no parent/child-run concept. Cancelling a workbench parent closes its admission
gate and cancels all retrievals already linked to that parent atomically with
respect to creating another link.

## Dataset and decision facts

The workbench defines the first business artifact, `workbench.dataset.v1`.
The runtime continues to store opaque type/payload and allocate its immutable ID.
The workbench skill supplies this artifact only after ontology-authorized final
execution. The runtime artifact ID is the dataset ID everywhere; there is no
parallel sequence-based dataset identity.

```ts
type DatasetPayload = {
  title: string;
  question: string;
  columns: {key: string; label: string; type: string | null}[];
  rows: Record<string, JsonValue>[];
  recipe:
    | {kind: "dsl"; dsl: JsonObject; executedCode?: string; sha256?: string}
    | {kind: "python"; code: string; sha256: string}
    | {kind: "metric"; metricId: string; revision: string;
       parameters: JsonObject; executedCode: string; sha256: string};
  outKeyRefs: {key: string; className: string; attrName: string;
              asGroupBy: boolean; statCal: boolean}[];
  // Reuse ResultTruncation semantics, not a model's completeness estimate.
  truncation: null | {truncated: true; rowLimit: number; truncationHint: string};
  assumptions: string[];
  decisionIds: UUID[];
  metricUses: {id: string; revision: string;
               use: "direct" | "derived" | "not_used"; reason: string}[];
  selfCheck: {scope: string; filters: string; grain: string;
              denominator: string; nullGroups: string;
              comparisons: {metricId: string; comparable: boolean;
                explanation: string; executionRef: string | null}[]};
  execution: {receiptId: UUID; executedAt: ISODate};
};
```

Rows preserve JSON null, false, zero, empty strings and original numeric values.
Top-level row keys must equal column keys and `outKeyRefs.key`, without duplicates.
Java validates source class/attribute existence and applies the existing grouping,
statistical-column and masking rules. Nested JSON values are not silently
flattened; the prompt requests flat tables, as before. Empty rows do not remove
the schema. Java remains the only interpreter of permission rules.

Source completeness and business assumptions are different facts. A partial input
remains partial after Python aggregation or zero-row output. Final execution uses
its own completeness, never the exploration run's marker. Transport-size overflow
is an explicit failure, not silent truncation or a fabricated adapter limit.
Full rows live in the immutable artifact, not the tool's model-visible text;
tools return schema, count and the existing bounded data view. The abc adapter,
live rendering, history and download all use one artifact-to-dataset projection.
No table is rewritten by a model. Existing query history may keep derived display
snapshots, but recipe/data authority is the referenced runtime artifact.

Decisions are workbench facts:
`{id, retrievalId, questionId, choiceId|null, text, scope, source, supersedesId|null}`.
`source` identifies a user answer or a previously authorized decision; a model
recommendation is not a user decision. Answers are committed with the next-round
admission intent under optimistic `decisionRevision`. Superseding an answer
invalidates the old decision for subsequent rounds, without editing old artifacts.
Decisions apply to this task by default and are not automatically published as
business knowledge. On continuation the workbench injects effective decisions
and prior artifact references into the same runtime session with fresh credentials.

## Ontology skill surface

`agent-skills/ontomato-analyst` is the ontology-owned source package, published as
`ontology/ontomato-analyst@2.0.0`. Its `runtime.json` declares typed tools; CLI and
runtime wrappers use the same HTTP routines. Ordinary internal/external usage has
only end-user authorization (U). Trusted retrieval has one narrow exploration
grant (E) fixed by the host for the ontology binding. Neither tool arguments nor
CLI options choose a user, domain, permission mode, grant or base URL override.

All paths below are **new** Java endpoints under `/ontology/query`; they delegate
to existing ontology services/utilities rather than copying their business rules.
This small read facade avoids granting ordinary readers management access or
making existing admin routes accept exploration credentials. Existing admin
routes remain for their other consumers. New responses are plain JSON with
non-2xx error responses, no success-shaped exception envelope.

| Tool / Java endpoint | Request | Credential | Response / existing owner |
| --- | --- | --- | --- |
| `ontology_overview` / `GET /overview` | None | U or E | `{description: string, classes: {name,description:string|null}[]}`; `AdminService`, `JSONRuleDao` |
| `ontology_schema` / `POST /schema` | `{classNames:string[]}` | U or E | `{classes:JsonObject[], relationships:JsonObject[]}`; enabled class attributes and direct relationships via ontology definitions |
| `ontology_dsl_reference` / `POST /dsl-reference` | `{classNames:string[]}` | U or E | `{classNames:string[], syntaxMarkdown:string, exampleMarkdown:string}`; `DslRuleUtil.generateDslRule/generateDslExample` |
| `ontology_distinct_values` / `POST /distinct-values` | `{className,attribute,like:string|null,limit:number}` | U or E | `{values:JsonValue[], displayedCount:number, truncation:ResultTruncation|null}`; existing distinct-value DSL, executed with resolved authority |
| `ontology_execute_dsl` / `POST /execute-dsl` | `{dsl:JsonObject}`; runtime tool can instead read one workspace `.json` file | U or E | `{data:[{answer:JsonObject[],truncated?:true,rowLimit?:number,truncationHint?:string}],dsl:JsonValue}`; shared normalized DSL execution |
| `ontology_find_metrics` / `POST /metrics/search` | `{query:string,classNames?:string[],cursor:string|null,limit:number}` | U or E | `{items:MetricSpec[],nextCursor:string|null}`; published read Functions only, exact domain |
| `ontology_execute_metric` / `POST /metrics/execute` | `{id,revision,parameters:JsonObject}` | U or E | `{recipe:MetricRecipe,outKeyRefs:OutKeyRef[],rows:JsonObject[],truncation:ResultTruncation|null,executionRef:string}`; MetricView/Function execution, no model-based parameter filling |
| `ontology_find_knowledge` / `POST /knowledge/search` | `{query:string,limit:number}` | U or E | `{items:{id,title:string|null,text,modifiedAt:ISODate|null}[]}`; knowledge retrieval, no dialogue-model call |

Relative paths in the table extend `/ontology/query`. The file form of the DSL
tool reads/strictly parses the file in the skill wrapper; Java receives only DSL,
never a runtime filesystem path. Failure returns a safe full cause and normalized
DSL only if execution reached that boundary. A preview shortened for model context
is distinct from an engine partial-result marker.

DSL documentation is generated on demand for normalized classes and actual
attribute types, using the current Java rule generator. Its common scope builder
moves out of `ABCProgrammerSkillTools`; it is not reimplemented in Node or Python.
`references/dsl.md` becomes an entry guide to this capability, not a second full
grammar. Syntax examples are platform grammar examples, not retired business
question/DSL/programmer examples. The new retriever does not inject
`abc_programmer_example` or `/bussinessexample` content.
The existing example generator returns Markdown containing a one-item DSL array;
the facade preserves that documented text shape. Instructions distinguish the
example wrapper from the execution tool's single-object input; neither Node nor
Python reparses Markdown to reconstruct the grammar.

`MetricSpec` contains `{id,revision,name,description:null|string,matchQuestions:string[],
type:"GENERAL"|"STATIC",function:{id,operation:"OPERATION_READ",code,logic:null|string,
parameters:Parameter[],returnDef:ReturnDef},context:{classes:JsonObject[],
fields:JsonObject[],parameterFields:JsonObject[],valueRanges:JsonObject[],
unresolved:string[]}}`. `revision` is a canonical spec digest, including Function
content; execution checks it and returns 409 if the spec changed. No copy of a
fixed Function or new MetricView model is introduced in this batch.

Metric search is deterministic SQL text/identity/class retrieval over published
definitions, with stable ordering and cursor pagination; **no dialogue or
embedding call**. It does not use `MetricViewServiceImpl.find`'s embedding-based
retrieval, nor `generateGeneralContent`'s parameter-filling agent. Knowledge search
reuses the existing retrieval/Embedding path, without a dialogue-model call.
The host initially requests at most ten complete specs and injects nextCursor
when more are available; the retriever can request further pages. Code and
parameter definitions are never cut in half.
Optional Java fields such as descriptions, parameter `sample/value/classNames`,
return metadata and timestamps may be null; normalize only where their absence
has defined semantics. Retrieval failures must not become an empty catalogue.

Ontology code derives involved classes/fields and parameter bindings only from
available structured DSL/parameter definitions. Arbitrary Python is not a
reliably parseable DSL: retain its full code and declared sources, mark unknown
bindings in `unresolved`, and let the retriever inspect/probe. Do not invent value
ranges or assert the source declaration is complete program data lineage.

`ask` is a workbench capability. Keep the external analyst CLI's `ask` command,
but its adapter is workbench-owned and calls `/api/retrievals`; delete its Java
`/abcHarness` handling. The ontology runtime manifest contains only the read
tools above, never an `ask` tool that recursively invokes a retriever. The shared
external distribution does not make ontology service depend on workbench: Java
publishes/uses the ontology tool entries, and the external caller chooses ask.
Shared transport code is imported/generated from its one owner in enterprise
packages, with credentials and translated instructions supplied by the edition.
Ontology and workbench have separate configured product base URLs. The existing
ontology-manager gateway can expose Java's facade without a workbench hop; its
`/api/data-query` prefix is part of the configured ontology URL. No new blanket
Node-to-Java proxy is added here. Preserve the deployed gateway's existing paths
until their own migration; do not confuse an external URL with a runtime target ID.

## Grants and final execution (ontology authority)

The ontology service signs and validates short-lived grants. Only a configured
workbench service principal may call
`POST /internal/query-grants/exploration`. It presents its service credential
plus the verified user's original credential in its normal authentication header, and
`{retrievalId,runtimeSessionId,runtimeRunId,expiresAt,classNames}`. Java verifies
the user/domain and query authorization itself. It rejects caller user/domain
claims. Public identity still requires the private service credential to issue E.

Grant claims: issuer, audience `ontology-query`, purpose `retrieval-exploration`,
service principal, user, domain, retrieval/session/run IDs, class scope, jti,
issuedAt and expiresAt. Expiry is the existing query deadline (normally 600 s),
bounded by the original credential's expiry; no timeless or user-selected grant.
Use an ontology-only signing key, never a runtime host token. A persisted grant
record stores jti/run/domain/expiry/revocation; the other bindings are signed
claims, not a second plaintext bearer store.
Signature, exact audience/purpose, expiry, revocation, run header binding, domain
and allowed operation are checked at every request. Domain is the signed value;
request headers cannot replace it. Cancel/terminal closure revokes by run via the
same service principal. Expiry closes the crash window. In-flight accepted reads
may finish; closure prevents publishing their late results.

E is accepted only by the facade's read operations. It uses the existing empty
row/column permission semantics **inside its bound domain**. It cannot issue a
grant, execute arbitrary SQL/native operations, call admin/write/action/export
routes, or execute a write Function. The Java facade validates a read-only DSL
structure before adapter execution and rejects unsupported action/raw-query
forms. Reusing a generic data-source query tool is not read-only enforcement.

The runtime receives E only in the pinned ontology skill binding and the
retrieval's Python binding. Workbench result tools receive a user credential or
a distinct callback grant; ordinary/domain/MCP tools receive neither E nor its
issuer credential. E is not in registry packages, definition snapshots, stdout,
tool arguments or public responses. Process isolation is required in addition to
environment separation; see the code contract. Exploration display policy is
deferred; this batch makes no claim that model-visible exploration data cannot
be repeated by a model. It never treats those rows as an authorized dataset.

`POST /ontology/query/outputs` accepts U only and is not in the exploration tool
manifest. The workbench calls it with `{submissionId,recipe,outKeyRefs}` after it
has verified the submitted file against a successful runtime execution receipt.
Java revalidates referenced definitions and sources, creates a **fresh** execution
workspace, and always reruns the recipe with user-bound authorization. It owns
JSON-output parsing, source validation, column masking and completeness. It
admits with 202 `{id:submissionId,status:"running"}`. A matching completed retry
returns the same admission identity, never another execution. Scoped
`GET /ontology/query/outputs/:submissionId` returns
`{id,status,result,error}`, where status is running/completed/failed/cancelled/
interrupted and result is null until completed, then
`{receiptId,executedAt,recipe,outKeyRefs,columns,rows,truncation}`. The workbench
awaits that terminal result before returning the dataset skill result.

For Python, Java calls the runtime code API under its own `ontology` host
principal with a separate `user-read` grant. This grant resolves current user
permissions at each query, accepts no body user/domain, cannot explore or write,
and expires with that execution's deadline. The new helper sends only
`{dsl}` plus its injected credential; delete `/dsl/execute` and the `admin`
request-value shortcut, updating all live producers. Model calls have no
`formal`, `exploration`, `userId`, credential selector or privileged test reuse.
The runtime sees only code, files, an opaque credential and a configured target.

Output submission IDs deduplicate only identical requests within the same
user/domain scope. Workbench alone binds a submission to an authorized retrieval
round; Java does not validate a workbench business state. Java records the
associated runtime execution ID before HTTP admission. Lost responses reconcile
that ID; no blind rerun. The
workbench receives no access to another runtime host's execution objects. Java
offers scoped `POST /ontology/query/outputs/:submissionId/cancel` for
cancellation. The result is a receipt of final execution,
not a second permanent dataset store.

## Quality check boundary

Add Java `POST /query-quality-checks` with U plus workbench service auth:
`{id,question,programs:[{question,code,outKeyRefs}],recipes,classNames}`. The ID is
workbench-issued and bound to domain/user/retrieval round. Admission returns 202
`{id,status:"running"}`; matching retries return the same check, changed payload
409. `GET /query-quality-checks/:id` returns running/completed/failed and the
existing program descriptions, score, conclusion and fitted question when ready.
`POST /query-quality-checks/:id/cancel` closes that check. All lookups are scoped;
the old DAO's sessionId-only lookup is not exposed as authorization.

The workbench starts this after an accepted completed retrieval, once per round,
using final recipes, not exploration source. Java retains `CheckServiceV2`'s
blind description/checking prompts, score and candidate threshold (60), and the
existing pending Function/MetricView creation. No score-triggered recompute or
new publication rule. The request also carries `recipes`; Java converts a DSL recipe through its
existing DSL-to-program owner before invoking the checker. Minimal admission/status ownership wraps the existing
logic; it does not migrate the checker agent.

The workbench persists the returned check ID and late result against its
retrieval/query record plus dataset IDs. This job has its own existing 60 s read
deadline and does not keep the chat turn open. A late result cannot overwrite a
later round or mutate the immutable dataset. Current display/QC history uses
the existing QcResult projection; the new retrieval GET can show the late job's
status. Waiting in `late-fact` is removed for this migrated path only; traditional
ABC checks keep their current path until that migration. Failed/cancelled checks
do not turn a delivered dataset into query failure. Java restart during candidate
creation is reported as interrupted/unknown and is never automatically replayed.


Final DSL/metric recipes carry the actual executed source and digest. Java
materializes a metric's typed parameters in its executable snapshot, preserving
nulls and the unchanged published Function source, so saved-program consumers
retain the calculation when replaying code. This is protocol-2 input assembly,
not legacy source conversion or a guessed rewrite. The original metric ID,
revision and structured parameters remain in the recipe. Dataset projection and
legacy trace arrays keep the same dataset ordering, including mixed DSL/Python
outputs.
