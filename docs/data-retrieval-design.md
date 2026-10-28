# Retrieval through standard skills

Implementation, 2026-10-28, replacing the batch 2 execution shape. The shared shapes are in
[data-retrieval.md](../packages/contracts/data-retrieval.md); the harness,
governance migration and complete removal matrix are in
[agent-runtime-design.md](agent-runtime-design.md). This document owns retrieval
assembly and the external-agent acceptance procedure, not another wire schema.

## One path inside and outside the product

The retriever uses model role coding, its existing business prompt and two
standard skills: ontology's ontomato-analyst and workbench's data-retrieval.
Governance uses model role knowledgeGovernance and knowledge-governance. Runtime
has no recognizer for these names or roles. Public/enterprise prompt translation
stays in the existing host template overlay. Both append the one shared Markdown
reference rule and point at their selected skill catalog.

1. Workbench authenticates the complete question, creates its business record,
   parent association and runtime session/run intent, and snapshots language,
   class scope and the existing query deadline. It validates prior artifact IDs.
2. Preserve existing host prefetch of knowledge, ontology overview and full
   published metric specs. Metric search is model-free, knowledge can use its
   current Embedding owner. Null fields are legitimate where the Java contract
   says so. A failed dependency does not become an empty catalogue.
3. Publish the actual standard skill directory bytes, then admit the run with
   name references, prompt, coding role and one environment. The ontology-issued
   query grant retains its existing run/domain/expiry semantics. The runtime
   resolves package digests and sets identity/paths; it does not interpret grants.
4. The model reads SKILL.md, invokes ontomato.mjs for schema, references, probes,
   DSL, metrics and knowledge. It can read/write/edit source using PI tools and
   execute Python with bash. The Python helper is the same file Java publishes
   for standalone code execution, with the same environment variable names.
5. To publish a dataset the model writes a recipe under work/ and invokes
   data-retrieval/scripts/dataset.mjs. That command obtains final authorized
   execution from the workbench/ontology path and writes the returned file under
   outputs/. Runtime registers it, and the host validates the stored snapshot
   against its owned final receipt before exposing it as a dataset.
6. The assistant references the file and stops normally. If it needs information,
   it asks in ordinary text and stops; there is no finish command. The host reads
   PI state and closes the gate, retaining all accepted artifacts. Replies create
   a new run in the same session with persistent source/work files and fresh env.
7. Eligible final datasets trigger the existing asynchronous Java QC once. Keep
   its business logic and late attachment; no score-triggered rewrite is added.

The direct authorized output endpoint remains the permission owner even when
exploration and formal output happen to see equal data. Bash no longer produces
a special Python execution receipt; the formal rerun is the authoritative
execution. Keep exact source/digest in the recipe and the final receipt in the
file. User-facing data, download and existing abc arrays all derive from that
accepted file; the model does not rebuild a second table in text.

Current LangGraph/static/hot/traditional branches remain. Only the retrieval
adapter changes its input projection. A normal no-dataset answer is preserved
as text/no-data at the old branch boundary; automatic next-chat-message routing
still belongs to batch 3. Public ask explicitly resumes by retrieval ID and
expected run/revision with a free-text message. Removing the three-state
retrieval envelope necessarily updates ask, branch consumers, test evidence and
localized prompts together; no alias or private outcome tool remains.

## Package layout and distribution

ontomato-analyst keeps SKILL.md, ontomato.mjs, client.mjs, application.yml,
python/query_runtime.py and references/. Remove runtime.json/runtime.mjs and
Runtime invocation prose. env overrides configuration independently per key;
missing required URL fails before a request. Never overwrite the user's config
when copying a skill into an external project. tk from the environment bypasses
interactive login convenience and uses the same command implementation in both
editions. application.yml remains a fallback, not a requirement inside runtime.

The workbench owns two package roots under resources/runtime-skills. Each contains
SKILL.md, scripts/ and references/, with no dependency on an installed server
module or product checkout. Plain CLI JSON output is command output, not a
runtime parser contract. Skill references carry argument/file-format help; bodies
teach when to read them. Keep all files needed by each CLI in its package.

Java resource packaging must publish the whole analyst directory, including CLI
files currently omitted by RuntimeCodeClient's hardcoded list. Both npm/app
resource copying and enterprise en/zh distribution generation must produce the
same executable bytes. Languages can change instruction text, but product and
external acceptance compare hashes for the exact language package being tested.
The implementation should use the existing source-generation/package-copy owner;
do not create another maintained executable copy.

The standard data-retrieval package documents dataset preparation and host work
identity commands. ontomato-analyst's existing ask stays a workbench client; the
retriever prompt uses direct queries, not recursive ask. A future main-assistant
skill may call the same public orchestration API in batch 3 without introducing
a second retrieval service.

## Worktree implementation proof

Reuse existing real-process tests under agent-runtime and the governance/retrieval
services. Use an isolated PG schema/data directory and independent child processes;
keep fixtures shaped like actual Java responses, including null descriptions,
nullable model fields, parameter sample/value/classNames and revision metadata.

Keep one main-path smoke for governance and Python retrieval, plus cancellation
and restart/aborted. Retain the contracts for file immutability, closed gates and
identities; do not add more fault scenarios. The existing free-text continuation
and copied-skill checks remain valid. Native checks do not prove Linux isolation
or live-model question quality.

The runtime design lists the focused contract/smoke scope and existing check
entry points. Record actual commands and logs at handoff. Main
checkout build/stack tests remain with the controller; no image is built here.

## Controller: Claude Code portability acceptance

Run after segment 2 and main-directory host startup. Use a temporary project
outside product checkouts. This procedure is a plan, not a claim that Claude Code
has been run. The work-gate endpoints were approved by the controller.

1. Copy the published ontomato-analyst, knowledge-governance and data-retrieval
   directories unchanged under the temporary project's .claude/skills/. Record a
   path/content SHA-256 inventory of each and compare with the runtime-published
   digest for those exact bytes. Do not add a runtime wrapper or edit SKILL.md.
2. Supply environment from a shell with authorized test-user tk, service URLs,
   language and an outputs directory. Use Node and the existing Python dependency
   set. Do not give the external harness a runtime host service credential.
3. With ordinary analyst commands read overview/schema/DSL examples/knowledge,
   probe a stored value and execute a simple query. Then ask Claude Code to answer
   a real multi-table question with Python post-calculation when needed. Observe
   that it reads the skill and runs its documented scripts, rather than merely
   returning a guessed answer. Save the external transcript and command trace.
4. Use the data-retrieval skill's begin command to obtain the authenticated host
   retrieval/session/run identity, set those documented env values, then have
   Claude Code produce a recipe and run dataset.mjs. Open the local dataset file,
   verify receipt/source/rows under the test user's permissions, and close the
   work run. This execution does not call /api/retrievals to start another agent.
5. Use governance begin to obtain an external work identity. Have Claude Code
   read knowledge and ontology, search/read history, inspect evidence, and save
   a work record through the same governance script. Confirm sources/count/work
   in host storage. Close the gate and prove a later update receives 409. At least
   read knowledge, read ontology, search history and update work must use real
   product data; mechanical tests cover empty environments for the other actions.
6. In product, select those same published package digests and repeat retrieval
   and governance. Compare executed script paths and bytes; different harness
   tool-call IDs are expected. Verify datasets in current page/history/download,
   cancellation, restart→aborted and same-session reply. Save runtime IDs, artifact
   IDs/digests and a short model-output review for each scenario.
7. Controller builds the actual runtime image in the main checkout and runs the
   enterprise four-image smoke, configured Java startup and Linux UID/rlimit/
   file-immutability probes. Record source SHAs/image digest/size and actual
   dependency imports, including PI 1.4 factories and Python. Only then report
   image/stack acceptance. The remote 35-question benchmark is a separate
   authorized step with comparable data/model settings and per-question results.

The decisive evidence is unchanged packages doing real business reads/writes in
both harnesses. Passing unit tests, API health or a successful build alone does
not establish that result.
