# Ontology-owned retrieval

Review proposal, 2026-10-28. This replaces workbench retrieval ownership; source
at `cc5ac842` still implements the old owner. Wire changes are in
[data-retrieval](../packages/contracts/data-retrieval.md), host placement and
implementation slices in [ontology AI](ontology-ai-runtime-design.md).

## First consumer of the Java host

Retrieval remains one definition: current prompt, `coding` role, `ontomato-analyst`
and `data-retrieval` standard skills, both published by provider `ontology`.
Runtime executes them; Java owns retrieval policy and performs this flow:

1. Verify user/domain; persist retrieval input, run intent and write gate. Validate
   prior datasets; retain continuation decisions, revisions and idempotency.
2. Read overview, knowledge and published metric context from existing Java
   services. Issue the exploration grant locally and pass it directly to the
   retrieval run. Remove the workbench grant round trip.
3. Admit/observe via the shared runtime client. Reconcile messages, PI state and
   file registrations from authoritative snapshots after response loss/restart.
   Never replay unknown external effects.
4. `dataset.mjs` calls Java's retrieval output endpoint, which invokes the existing
   formal-output service locally under user permissions. The script atomically
   writes the returned dataset file.
5. Verify registered files against owned receipts/digests; expose references, not
   another permanent row copy. Close writes before cancelling/superseding runs.
6. Schedule eligible asynchronous QC once; reference the existing Java QC record
   instead of copying its result into another retrieval store.

## Move and remove together

| Current source | Destination / treatment |
| --- | --- |
| Workbench `services/data-retrieval/{service,store}.ts` | Java retrieval service/DAO: admission, continuation, reconciliation, deadline, receipts, dataset acceptance and QC scheduling. Rewrite, do not embed Node. |
| `retrievals`, `retrieval_rounds`, `retrieval_submissions` | Ontology-owned tables referencing common host sessions/runs; decisions stay business facts. No workbench SQL joins. |
| `retrieval_parent_gates`, retrieval `parent_id` | Reviewed caller boundary; only workbench knows what the parent means. No runtime parent/child protocol. |
| `data-retrieval/ontology.ts`, `skill.ts` | Local Java query services and ontology skill publication; delete Node adapters. |
| `resources/runtime-skills/data-retrieval/**` | Public `agent-skills/data-retrieval/**`, packaged/published by Java; dataset.mjs calls ontology. |
| Public/enterprise workbench `resources/prompts/data-retrieval/system.md` | Corresponding `data-engine-core`/`data-engine-enterprise` `src/main/resources/prompts/data-retrieval/system.md`; keep English/Chinese semantics. |
| `assistant-retrieval/**`, including `scripts/ask.mjs` | Delete; assistant and external agents use the single analyst `ask`, extended to download accepted bytes through ontology's proxy. |
| Workbench `/api/retrievals`, route mount, registration/startup and retrieval schema initializer | Delete. Old stored data is reserved for release conversion, not read, converted or dropped here. |
| Assistant `/sessions/:sessionId/runs/:runId/retrievals` start/read/content callbacks | Delete with assistant-retrieval; retain the separate dataset-source/evidence actions and parent lifecycle integration. |
| Retrieval `projection.ts` and unrelated transaction/fingerprint imports | Move live assistant evidence projection to its owner and shared transactions to infrastructure; no old-directory alias. |

Package complete skills from their source roots. Enterprise distributions generate
shared executable bytes from public source; translations remain edition-owned.
Move retrieval-only resources; keep genuinely shared compaction resources with
an explicit owner. Remove invalidated tests with the retired implementation.

## Workbench remains an application consumer

Map the assistant session/run to the proposed caller scope in the contract. The
same skill then calls Java directly; close also blocks admission whose response
has not arrived. Reconcile returned child references into `assistant_retrievals`;
no local retrieval state machine or observer is retained.

`ONTOMATO_TK` is always the current user's credential. The parallel domain-skills
module moves the old callback credential to `ONTOMATO_RETRIEVAL_CALLBACK_TOKEN`;
this cutover deletes that assistant-retrieval callback path entirely. The proposed
caller ID is separate, non-secret association metadata, not another meaning of tk.

One assistant evidence adapter reads Java retrieval evidence and the common host
proxy for dataset-source, dashboard/PPT and diagnosis/governance history. The
workbench runtime identity cannot read ontology child runs. Recognize copied
files only when original Java receipt/artifact and content digest agree; changed
copies are generic files. Read late QC by its Java reference. Closing an old
parent cannot cancel a reassigned child round or already finished QC.

Session deletion closes caller admission, reconciles child references and asks
Java to delete owned child resources; it no longer deletes retrieval rows directly.
Cleanup remains scoped to those associations and retryable by stable IDs.

## Acceptance after implementation

Keep focused contracts for Java/common-proxy interchange, receipt/file matching,
continuation idempotency and closed-run/caller admission. Relevant typecheck/lint
and both Maven compiles cover consumers; no prompt tests or exception matrix.

Controller runs actual assistant and external analyst ask against the same Java
entry: continuation, copied dataset evidence, cancel during admission and runtime
restart. Run unchanged dataset.mjs externally with begin/close and normal user
authority. Controller builds runtime/data-engine and runs the enterprise stack.
These are required future checks, not results of this proposal.
